/**
 * Wire protocol for the Open-Pencil remote-control hub.
 *
 * This is the canonical protocol shared by the automation hub and frontend.
 *
 * Design goals:
 *  - Simple, explicit, JSON-serializable messages.
 *  - Extensible: new `action` strings can be added without breaking existing
 *    clients (unknown actions get a typed `UNSUPPORTED_ACTION` error result,
 *    not a protocol-level failure).
 *  - Streaming is modeled as zero-or-more `event` messages followed by
 *    exactly one terminal `result` message per command `id`.
 */

export const REMOTE_CONTROL_PROTOCOL_VERSION = 1

export type RemoteControlAction = 'ping' | 'ai.request' | 'ai.configure' | 'fig.download' | (string & {})

/** Browser -> Hub: sent once, immediately after the WebSocket opens. */
export interface HelloMessage {
  type: 'hello'
  token: string
  sessionId: string
  protocolVersion: number
}

/** Hub -> Browser: a command to execute. */
export interface CommandMessage<TPayload = unknown> {
  type: 'cmd'
  id: string
  action: RemoteControlAction
  payload: TPayload
}

/** Browser -> Hub: zero or more progress events emitted while a command runs. */
export interface EventMessage<TPayload = unknown> {
  type: 'event'
  id: string
  action: RemoteControlAction
  event: string
  payload: TPayload
}

/** Browser -> Hub: exactly one terminal result per command id. */
export interface ResultMessage<TResult = unknown> {
  type: 'result'
  id: string
  ok: boolean
  result?: TResult
  error?: { code: string; message: string }
}

export type InboundMessage = HelloMessage | EventMessage | ResultMessage
export type OutboundMessage = CommandMessage

// ---- ai.request -------------------------------------------------------------

export interface AIRequestPayload {
  prompt: string
  /** Defaults to false: each request starts from a clean chat (see session.ts). */
  continueSession?: boolean
}

export interface AIStreamEventPayload {
  textDelta: string
  textSoFar: string
  done: boolean
}

export interface AIRequestUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
}

export interface AIRequestToolCall {
  tool: string
  mutates: boolean
}

export interface AIRequestResult {
  text: string
  finishReason: string
  usage: AIRequestUsage
  /** Distinct tools invoked during this turn. Best-effort; order not guaranteed. */
  toolCalls: AIRequestToolCall[]
}

// ---- ai.configure -------------------------------------------------------------

export interface AIConfigurePayload {
  providerID: string
  modelID?: string
  customModelID?: string
  customBaseURL?: string
  customAPIType?: 'completions' | 'responses'
  apiKey?: string
  maxOutputTokens?: number
  name?: string
}

export interface AIConfigureResult {
  profileId: string
  connectionId: string
  providerID: string
  effectiveModel: string
}

// ---- fig.download -------------------------------------------------------------

export interface FigDownloadResult {
  filename: string
  mimeType: string
  base64: string
  byteLength: number
}
