# @open-pencil/automation

Server-side, browser-based automation for the Open-Pencil web app. Launches
and drives a real Chromium instance (via [`puppeteer-cluster`](https://github.com/thomasdondorf/puppeteer-cluster)),
opens the running Open-Pencil site, sends design requests to the site's
**existing** AI chat pipeline, streams the response back, and can pull the
resulting design out as a `.fig` file — all without clicking through the UI.

```ts
const client = await OpenPencilAutomation.connect({ url: 'http://localhost:1420' })
const { result, figFile } = await client.generate({
  prompt: 'Create a modern SaaS landing page...'
})
// generate() closes the browser page after the .fig download completes.
await client.close()
```

## Why this exists / architecture

Open-Pencil already ships one browser-automation channel: the MCP bridge at
`src/app/automation/bridge/`. In dev mode, the Vite plugin spawns
`packages/mcp` as a small Node process (the "hub"); the running browser tab
dials **out** to it over WebSocket, authenticates with a token, and then
executes generic Figma-style RPC commands (`select`, `save_file`, `eval`,
...) that the MCP server forwards from an MCP client such as Claude Desktop.

This package follows the **same architectural pattern** — browser as
WebSocket client, token-authenticated, request/response over a single
socket — but as a **separate, dedicated hub** rather than extending
`packages/mcp`:

- `packages/mcp`'s protocol is a single-request/single-response RPC shape
  built for MCP tool calls. AI generation needs *streaming* progress events
  pushed to the caller before the final result, which is a different shape.
- Keeping this fully separate means the existing MCP/Claude-Desktop
  integration is completely untouched — zero risk of regressing it.
- The two hubs can run side by side; nothing about this package disables or
  competes with the MCP bridge.

```
Server / Automation Package (this package)
          |
          | WebSocket  (browser dials OUT to this process)
          v
Open-Pencil Remote Control Hub  (hub.ts, runs in this package's Node process)
          |
          +--> ai.request   -> drives the app's existing AI chat session
          |                    (src/app/ai/chat/use.ts), streams deltas back
          |
          +--> fig.download -> calls the app's existing exportFigFile()
          |                    (@open-pencil/core/io), returns bytes directly
          |
          +--> (extensible: add more `action` strings without breaking
                clients — unknown actions get a typed error, not a crash)
```

Frontend changes are intentionally tiny — see
`src/app/automation/remote-control/` (protocol types, the WS client, and two
one-file handlers) plus a ~5-line hook in `src/views/EditorView.vue` that
only activates when the page is opened with `?op-remote-control=1` (i.e.
never during normal interactive use). Neither handler reimplements AI or
`.fig` export logic:

- `handlers/ai.ts` calls `useAIChat().ensureChat()` and `chat.sendMessage()`
  — the exact same `Chat` instance `ChatPanel.vue` uses — and reads
  `chat.messages` (reactive) to stream deltas, plus `getStepUsages(store)`
  from `src/app/ai/tools` for token totals. It also sets
  `useAIChat().activeTab.value = 'ai'` (the same ref `PropertiesPanel.vue`'s
  tab control v-models to), so a headful run visibly switches the sidebar to
  the AI tab and streams into the real chat UI as it happens — nothing to
  "sync" separately, since it's the same reactive state the UI renders.
- `handlers/configure.ts` calls `saveModelProfileDraft()` /
  `setModelRoleAssignment()` from `@/app/ai/models` (the same store the
  Settings dialog writes to) and `useAIChat().setAPIKey()` (the same
  credential path the Settings API-key field uses) to point the chat at a
  provider/model/endpoint/token supplied by the caller.
- `handlers/fig.ts` calls `exportFigFile()` from `@open-pencil/core/io`
  directly (the same encoder `src/app/document/io/source.ts` uses for
  Save/Save As), but skips the browser download / native file-picker path
  since there's no UI for a server-side caller to click through.

### Context isolation

Every `ai.request` starts from a **clean chat by default** — the handler
calls the chat session manager's existing `resetChat()` (same function
Settings' "Reset conversation" affordance would use) before `ensureChat()`,
so sequential and concurrent generations never see each other's — or a
previous run's — conversation history. Pass `continueSession: true` in the
payload (or `session.sendAI({ prompt, continueSession: true })` from the
package) for an intentional multi-turn follow-up on the same design instead.
Concurrent sessions are additionally isolated at the browser level (separate
`puppeteer-cluster` contexts, see "Concurrency" below), so this only matters
for repeated calls *within* one session.

**App readiness** is derived from the hub handshake itself: the frontend
only opens its WebSocket once `EditorView.vue` has mounted, so "the hub sees
this session register" *is* "the app is ready" — no DOM polling needed.

## Protocol

One shared WebSocket per browser session. Messages are JSON, one message per
frame.

**Browser -> Hub**, once, right after the socket opens:

```json
{ "type": "hello", "token": "...", "sessionId": "...", "protocolVersion": 1 }
```

**Hub -> Browser**, one per command:

```json
{ "type": "cmd", "id": "req-1", "action": "ai.request", "payload": { "prompt": "Create a landing page..." } }
```

**Browser -> Hub**, zero or more progress events, then exactly one result,
correlated by `id`:

```json
{ "type": "event",  "id": "req-1", "action": "ai.request", "event": "start",  "payload": { "prompt": "..." } }
{ "type": "event",  "id": "req-1", "action": "ai.request", "event": "stream", "payload": { "textDelta": "Sure, ", "textSoFar": "Sure, ", "done": false } }
{ "type": "event",  "id": "req-1", "action": "ai.request", "event": "stream", "payload": { "textDelta": "here...", "textSoFar": "Sure, here...", "done": true } }
{ "type": "result", "id": "req-1", "ok": true, "result": { "text": "Sure, here...", "finishReason": "stop", "usage": { "inputTokens": 512, "outputTokens": 340, "cacheReadTokens": 0, "cacheWriteTokens": 0, "totalTokens": 852 } } }
```

Failure shape (same for any action):

```json
{ "type": "result", "id": "req-1", "ok": false, "error": { "code": "AI_NOT_CONFIGURED", "message": "No AI provider is configured..." } }
```

`fig.download`:

```json
{ "type": "cmd", "id": "req-2", "action": "fig.download", "payload": {} }
{ "type": "result", "id": "req-2", "ok": true, "result": { "filename": "Untitled.fig", "mimeType": "application/octet-stream", "base64": "...", "byteLength": 48213 } }
```

`ai.configure` — points the app's AI chat at a provider/model/endpoint/token
without touching Settings:

```json
{ "type": "cmd", "id": "req-3", "action": "ai.configure", "payload": { "providerID": "openai-compatible", "customBaseURL": "https://my-gateway/v1", "customModelID": "my-org/design-model-v2", "apiKey": "..." } }
{ "type": "result", "id": "req-3", "ok": true, "result": { "profileId": "model-...", "connectionId": "connection-...", "providerID": "openai-compatible", "effectiveModel": "my-org/design-model-v2" } }
```

**Extensibility**: `action` is an open string. New actions can be added on
both sides independently — a hub or frontend that doesn't recognize an
action returns `{ ok: false, error: { code: "UNSUPPORTED_ACTION", ... } }`
instead of breaking the connection, so older/newer clients keep working.

The canonical protocol types live in `src/protocol.ts`. The frontend keeps a
small, hand-synced, dependency-free mirror at
`src/app/automation/remote-control/protocol.ts` (see that file's header for
why it's duplicated instead of imported).

## Connecting the browser to the hub: query params, not a console object

The task requirements floated two options — a token-based query param, or
exposing a controllable object via `puppeteer`'s console. This package uses
the **query-param + outbound WebSocket** approach:

- `page.goto('http://localhost:1420?op-remote-control=1&op-remote-control-host=...&op-remote-control-port=...&op-remote-control-token=...&op-remote-control-session=...')`
- The frontend hook reads those params once at mount and, if present, opens
  the WebSocket described above.

This was preferred over `page.exposeFunction` / console-bridging because:
it matches the existing MCP bridge's proven pattern exactly; it survives
page reloads/navigation the same way (re-read from the URL); and it doesn't
require Puppeteer to inject/re-inject bindings after every navigation. The
console *is* still used, but only for debugging: `forwardConsole: true`
(the default) pipes the page's `console.*` output to this process's stdout,
prefixed with the session id, which is handy with `headless: false`.

## Concurrency

Each session is one isolated browser context
(`Cluster.CONCURRENCY_CONTEXT`) with its own hub connection and its own
`Chat` instance inside that page — sessions never share app state, so
concurrent AI generations are fully independent:

```ts
const client = await OpenPencilAutomation.connect({ concurrency: 3 })
const sessions = await Promise.all([client.createSession(), client.createSession(), client.createSession()])
const results = await Promise.all(
  sessions.map((session, i) => session.sendAI({ prompt: prompts[i] }))
)
await Promise.all(sessions.map((s) => s.close()))
await client.close()
```

`client.sendAI(...)` / `client.downloadFig(...)` are sugar over a single
lazily-created "default session" for simple, sequential scripts (see the
top-level example). Use `client.createSession()` whenever you want more than
one design running at once. `OPENPENCIL_MAX_CONCURRENCY` (default `4`)
caps how many sessions can be actively running in the browser at a time;
additional `createSession()`/`sendAI()` calls queue until a slot frees up.

`createSession({ url })` opens that session at a different URL than the
`connect()`-level default — e.g. a signed "open this specific saved design"
frontend URL instead of a blank document. See `packages/automation-server`
for a worked example that opens existing designs this way.

## Model configuration (custom endpoint, model, token)

Set these once in `.env` and every session is configured automatically
before any prompt is sent — no manual Settings-dialog step:

```bash
# Named provider:
OPENPENCIL_AI_PROVIDER=anthropic
OPENPENCIL_AI_MODEL=claude-sonnet-4-6-20260301
OPENPENCIL_AI_TOKEN=sk-ant-...

# Or a fully custom / self-hosted OpenAI-compatible endpoint:
OPENPENCIL_AI_PROVIDER=openai-compatible
OPENPENCIL_AI_BASE_URL=https://my-llm-gateway.internal/v1
OPENPENCIL_AI_CUSTOM_MODEL=my-org/design-model-v2
OPENPENCIL_AI_TOKEN=my-gateway-token
```

Or per call, which also lets different concurrent sessions use different
models:

```ts
const client = await OpenPencilAutomation.connect({ aiModel: null }) // skip env default

const session = await client.createSession({
  aiModel: {
    providerID: 'openai-compatible',
    customBaseURL: 'https://my-llm-gateway.internal/v1',
    customModelID: 'my-org/design-model-v2',
    apiKey: process.env.GATEWAY_TOKEN!
  }
})
```

`providerID` accepts any of Open-Pencil's built-in providers (`openrouter`,
`anthropic`, `openai`, `google`, `deepseek`, `zai`, `minimax`) or
`openai-compatible` / `anthropic-compatible` for a fully custom endpoint —
the same set the Settings dialog offers, since this reuses that same
model-settings store (`saveModelProfileDraft`) rather than a separate config
path. See `packages/automation/examples/configure-demo.ts`.

## Setup

```bash
# 1. In one terminal, start Open-Pencil itself (repo root):
bun run dev
# -> serves http://localhost:1420

# 2. In another terminal:
cd packages/automation
cp .env.example .env    # adjust if needed; defaults work out of the box
bun install              # first time only, from the repo root
bun run demo
```

> **Note:** `sendAI` drives the app's real AI chat session, which requires
> an AI provider/API key to already be configured in that browser profile
> (Settings -> AI in the app). This package does not provision credentials
> for you — it automates the same pipeline a signed-in user would use, on
> purpose, rather than re-implementing AI calls independently.

## API

```ts
import { OpenPencilAutomation } from '@open-pencil/automation'

const client = await OpenPencilAutomation.connect({
  url: 'http://localhost:1420',   // defaults to OPENPENCIL_URL
  headless: false,                 // visible browser, for debugging
  viewport: { width: 1980, height: 1080 },
  concurrency: 4,
})

// Simple, sequential usage:
const result = await client.sendAI({
  prompt: 'Create a modern SaaS landing page...',
  onEvent: (event) => {
    if (event.type === 'delta') process.stdout.write(event.textDelta)
  }
})
// result: { sessionId, requestId, text, finishReason, usage, toolCalls }
// toolCalls: distinct tool names invoked this turn (e.g. ["createFrame", "createText"]),
// read from the chat's own message parts — best-effort, order not guaranteed.

const figFile = await client.downloadFig({ saveToPath: './output.fig' })
// figFile: { filename, mimeType, bytes: Uint8Array, byteLength }

await client.close()
```

For a one-shot generation that always closes its browser page after the `.fig`
download, use `generate()`:

```ts
const { result, figFile } = await client.generate({
  prompt: 'Create a modern SaaS landing page...',
  download: { saveToPath: './output.fig' }
})
```

Async-iterator style, instead of a callback, via an explicit session:

```ts
const session = await client.createSession()
const { events, result } = session.streamAI({ prompt: '...' })
for await (const event of events) {
  if (event.type === 'delta') process.stdout.write(event.textDelta)
}
const final = await result
await session.close()
```

Use `session.generate({ prompt, download })` when a session should generate one
design, download it, and close its page automatically. Use `sendAI()` and
`downloadFig()` separately when the page must stay open for follow-up prompts.

### Errors

Every failure is an `OpenPencilAutomationError` with a stable `.code`:
`CONNECTION_FAILED`, `PAGE_LOAD_FAILED`, `NOT_READY`, `HUB_START_FAILED`,
`AUTH_REJECTED`, `SESSION_DISCONNECTED`, `REQUEST_TIMEOUT`,
`AI_NOT_CONFIGURED`, `AI_REQUEST_FAILED`, `AI_REQUEST_IN_PROGRESS`,
`DOWNLOAD_FAILED`, `PROTOCOL_ERROR`, `UNSUPPORTED_ACTION`,
`BROWSER_CRASHED`, `CLUSTER_ERROR`, `INVALID_PAYLOAD`, `CLIENT_CLOSED`.
Nothing is swallowed — connection issues, timeouts, malformed messages, page
crashes, and cluster shutdown all reject with one of these instead of
hanging or failing silently.

## Files

```
packages/automation/
  src/
    env.ts            T3 env (@t3-oss/env-core) — validated configuration
    protocol.ts        canonical WebSocket message/type definitions
    errors.ts          typed error hierarchy
    async-queue.ts      tiny async FIFO used to feed a long-running session
    hub.ts              the remote-control hub (WebSocket server)
    session-task.ts     Puppeteer-side page bootstrap + per-session command loop
    session.ts          OpenPencilSession (sendAI / streamAI / downloadFig / close)
    client.ts           OpenPencilAutomation (connect / createSession / close)
    types.ts             public API types
    index.ts             barrel export
  examples/
    demo.ts               connect -> sendAI (streamed) -> downloadFig -> close
    configure-demo.ts     multiple sessions, each on a different provider/model/endpoint
    concurrent-demo.ts    multiple sessions running sendAI + downloadFig in parallel
  .env.example
  package.json
  tsconfig.json
  tsdown.config.ts
```

Frontend counterpart (see repo root):

```
src/app/automation/remote-control/
  protocol.ts          hand-synced mirror of packages/automation/src/protocol.ts
  client.ts             browser-side WebSocket client (dials out to the hub)
  handlers/ai.ts        ai.request -> useAIChat().ensureChat() + chat.sendMessage()
  handlers/fig.ts        fig.download -> exportFigFile() from @open-pencil/core/io
  index.ts               barrel export

src/views/EditorView.vue   +~5 lines: connectRemoteControl(params) on mount,
                             disconnect on unmount. Inert unless
                             ?op-remote-control=1 is present in the URL.
```
