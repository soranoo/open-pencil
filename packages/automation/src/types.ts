import type { AIRequestToolCall, AIRequestUsage } from './protocol'

export interface AIModelConfig {
  /** e.g. 'openai-compatible' | 'anthropic-compatible' | 'openai' | 'anthropic' | 'google' | 'deepseek' | 'zai' | 'minimax' | 'openrouter' */
  providerID: string
  /** Built-in model id for named providers. */
  modelID?: string
  /** Free-form model id; required for 'openai-compatible' / 'anthropic-compatible'. */
  customModelID?: string
  /** Custom endpoint URL. Only used by 'openai-compatible' / 'anthropic-compatible'. */
  customBaseURL?: string
  customAPIType?: 'completions' | 'responses'
  /** API key / token for the provider. */
  apiKey: string
  maxOutputTokens?: number
  /** Display name for the saved model profile. Defaults to "Automation (<providerID>)". */
  name?: string
}

export interface AIModelConfigResult {
  profileId: string
  connectionId: string
  providerID: string
  effectiveModel: string
}

export interface ConnectOptions {
  /** URL of the running Open-Pencil dev server. Defaults to env/OPENPENCIL_URL. */
  url?: string
  /** Host the hub's WebSocket server binds to. Defaults to env/127.0.0.1. */
  hubHost?: string
  /** Port the hub's WebSocket server binds to. 0 = random free port (default). */
  hubPort?: number
  /** Shared auth token the frontend must present. Defaults to a random token. */
  token?: string
  /** Run Chromium headless. Defaults to false (visible, for debugging). */
  headless?: boolean
  /** Browser viewport size. Defaults to 1980x1080. */
  viewport?: { width: number; height: number }
  /** Max number of concurrent browser sessions/contexts. Defaults to 4. */
  concurrency?: number
  /** Default timeout for the page to load + register with the hub. */
  readyTimeoutMs?: number
  /** Default timeout for `sendAI` calls. */
  aiTimeoutMs?: number
  /** Default timeout for `downloadFig` calls. */
  downloadTimeoutMs?: number
  /** Default timeout for `configureAI` calls. */
  configureTimeoutMs?: number
  /**
   * Custom model endpoint/model/token to configure automatically on every
   * new session (before any sendAI call). Defaults to the OPENPENCIL_AI_*
   * environment variables when set. Pass `null` to explicitly skip
   * env-based auto-configuration (e.g. when each session sets its own model
   * via `createSession({ aiModel })`).
   */
  aiModel?: AIModelConfig | null
  /** Forward the browser page's console output to this process's stdout. Defaults to true. */
  forwardConsole?: boolean
  /** Additional Chromium launch args. */
  browserArgs?: string[]
}

export interface SendAIOptions {
  prompt: string
  /**
   * By default every `sendAI`/`streamAI` call starts from a clean chat, so
   * concurrent and sequential generations never share context. Pass `true`
   * for an intentional multi-turn follow-up on the same session instead.
   */
  continueSession?: boolean
  /** Overrides the connection-level AI timeout for this call only. */
  timeoutMs?: number
  /** Called for every streaming event (in addition to consuming `.events`). */
  onEvent?: (event: AIStreamEvent) => void
}

export interface GenerateOptions extends SendAIOptions {
  /** Options for downloading the generated design before the page is closed. */
  download?: DownloadFigOptions
}

export type AIStreamEvent =
  | { type: 'start'; prompt: string }
  | { type: 'delta'; textDelta: string; textSoFar: string }
  | { type: 'done'; text: string }

export interface AIResult {
  sessionId: string
  requestId: string
  text: string
  finishReason: string
  usage: AIRequestUsage
  /** Every tool invocation emitted during this turn, in execution order. */
  toolCalls: AIRequestToolCall[]
  /** Whether the app stopped the agent after reaching its configured step budget. */
  hitStepLimit: boolean
}

export interface DownloadFigOptions {
  timeoutMs?: number
  /** If set, also write the file to disk at this path. */
  saveToPath?: string
}

export interface FigFile {
  filename: string
  mimeType: string
  bytes: Uint8Array
  byteLength: number
}

export interface GeneratedDesign {
  result: AIResult
  figFile: FigFile
}

export interface SessionOptions {
  /** Overrides the connection-level ready timeout for this session only. */
  readyTimeoutMs?: number
  /**
   * Overrides the connection-level default URL for this session only — e.g.
   * a signed frontend URL that opens a specific saved design instead of a
   * blank document. Any of this session's own query params are merged in
   * (`op-remote-control` etc.), so existing query params on this URL (like
   * a signed `design`/`key`/`sign`) are preserved.
   */
  url?: string
  /** Overrides the connection-level default aiModel config for this session only. Pass `null` to skip auto-configuration for this session. */
  aiModel?: AIModelConfig | null
}
