# @open-pencil/automation-server

Prompt-to-design HTTP backend. Forked from a headless server template that
ran its own in-process AI SDK tool-calling loop against an in-memory
`@open-pencil/core` document. **This version instead drives the real
Open-Pencil web app in a real browser via
[`@open-pencil/automation`](../automation)** — same AI chat pipeline, same
`.fig` exporter, that a human user gets. No separate AI engine to keep in
sync with the app.

**The HTTP API is unchanged.** Every route, request/response schema, and
status code is identical to the template this was forked from — see
"What changed" below for the exact file-by-file diff. Anything that already
integrates against the template's API works against this server without
modification.

## What changed

### Kept byte-for-byte identical
Routes, schemas, and all generic infrastructure — none of this needed to
change because none of it depended on *how* generation happens, only on the
`processGenerateRequest(body) -> GenerateResponse` / `saveDesignSession(id)`
/ `getSession(id)` contracts, which are preserved exactly:

```
src/index.ts                    all routes, OpenAPI docs, middleware
src/schemas.ts                  every zod schema
src/routes/*.ts                 all 8 route handlers
src/auth/api-key.ts             Bearer/x-api-key auth middleware
src/design-auth.ts              signed-URL + cookie design auth
src/document.ts                 still used by routes/put.ts for byte validation
src/utils/get-uuid.ts
src/db/*  src/kv/*  src/storage/*  src/queue/*   (incl. queue/generate-worker.ts)
```

### Rewritten (same exported contract, new internals)
```
src/generate.ts          same GenerateRequest/GenerateResponse/generateResultSchema/
                          DesignNotFoundError/processGenerateRequest — now calls
                          automation-engine.ts instead of the headless chat-engine
src/session-manager.ts   same createSession/getSession/markSaved signatures (the ones
                          routes/put.ts and queue/generate-worker.ts import) — no longer
                          holds a live in-memory document, just KV metadata + temp .fig bytes
src/design-save.ts       same ActiveSessionNotFoundError/saveDesignSession/isDesignSaved —
                          promotes temp bytes to permanent storage instead of re-serializing
                          a live graph that no longer exists in this process
src/env.ts                same server-scoped vars (PORT, DB/KV/storage/queue config, design
                          signing, ...); AI-provider vars moved to @open-pencil/automation's
                          own env (one place to configure a model, not two)
```

### New
```
src/automation-engine.ts   replaces chat-engine.ts. Pools one live browser session per
                            in-progress designId via @open-pencil/automation; reopens saved
                            designs through the app's own signed-URL loader when no live
                            session remains (see "Continuing a design" below)
```

### Removed (the headless AI engine and its support cast — no longer applicable)
```
src/chat-engine.ts             in-process AI SDK tool-calling loop
src/headless-tools.ts          FigmaAPI-based tool implementations for that loop
src/model.ts                   AI SDK model resolution for that loop
src/fixed-height-guardrail.ts  post-tool-call layout guardrails for that loop
src/overflow-guardrail.ts
src/overlap-guardrail.ts
src/system-prompt.md           system prompt for that loop (the real app has its own)
src/globals.d.ts               only existed for the *.md import above
debug-overflow-analysis.ts, test.ts, test-2.ts, tmp.json    dev scratch files
```

`package.json` dropped `@ai-sdk/*`, `@openrouter/ai-sdk-provider`, `valibot`,
`node-html-to-image` (all only used by the removed files) and added
`@open-pencil/automation`. `ai` stays as a dependency — `db/interface.ts` and
`session-manager.ts` still use its `ModelMessage` type for `promptHistory`.

Two `GenerateResponse` fields are necessarily best-effort now that generation
happens inside the real app's own agent loop rather than a locally-run,
inspectable one:
- **`toolLog`**: real tool names, read from the chat's own message parts —
  but `mutates` is always `true` (the original tool registry tracked this
  per tool definition, which doesn't exist server-side anymore).
- **`hitStepLimit`**: always `false` — the app's own step limit is enforced
  inside the browser; this process has no visibility into whether it fired.

## Browser page lifecycle

Each `/generate` request creates one isolated browser session, generates and
downloads the design, then closes the page and browser context completely
before the request is marked complete. This releases the browser slot for the
next queued design request, including when generation fails.

Because the page is intentionally closed after every request, a follow-up
`/generate` call using the same `designId` must target a design that was saved
with `POST /design/:id/save`; saved designs reopen through the signed frontend
URL returned by `GET /design/:id/url`. Unsaved designs cannot be continued
after their generation page has closed.

## Setup

```bash
# 1. Open-Pencil frontend running somewhere reachable (repo root):
bun run dev   # -> http://localhost:1420

# 2. This server:
cd packages/automation-server
cp .env.example .env
# fill in SERVER_API_KEY, DESIGN_SIGNING_SECRET, FRONTEND_URL, and the
# OPENPENCIL_AI_* vars (see .env.example — same names as @open-pencil/automation)
bun install   # from the repo root, first time only
bun run dev   # -> http://localhost:8787

# 3. Try it:
bun run examples/demo.ts

# Download an existing saved design:
DESIGN_ID=<saved-design-uuid> bun run examples/download-demo.ts
```

Postgres/MinIO for production-shaped local dev:

```bash
docker compose up -d          # postgres + minio (+ minio-init)
# uncomment the `server:` service in docker-compose.yml to also run this
# server as a container (needs OPENPENCIL_HEADLESS=true and a reachable
# frontend — see the comments in that file)
```

## API reference

Unchanged from the original template — included here for convenience, all
under `/api/v1`, all requiring `Authorization: Bearer $SERVER_API_KEY` (or
`x-api-key`) unless noted:

| Method | Path                        | |
|---|---|---|
| GET  | `/health`                          | Liveness check |
| POST | `/generate`                        | Enqueue a design request (`{ prompt, designId?, autosave? }`) |
| GET  | `/generate/status/:requestId`      | Poll status/result |
| GET  | `/generate/status/size`            | Pending job count |
| POST | `/design/:designId/save`           | Promote the in-progress design to permanent storage |
| GET  | `/design/:designId`                | Fetch saved `.fig` bytes (`?format=json` for base64+metadata) |
| GET  | `/design/:designId/download`       | Download the saved `.fig` file |
| PUT  | `/design/:designId`                | Upload bytes the browser is holding (manual edits) |
| GET  | `/design/:designId/url`            | Signed frontend URL to open the design |
| GET  | `/design/:designId/auth`           | Exchange a signed URL for a session cookie |

`ENABLE_OPENAPI_DOCS=true` also serves interactive docs at `/api/v1/openapi/docs`.

See `examples/demo.ts` for a full generate -> poll -> save -> fetch walkthrough,
or `examples/download-demo.ts` for a focused saved-design download example.
