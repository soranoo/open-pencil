/**
 * Typed errors surfaced by the automation package. Every failure path
 * throws one of these instead of a bare Error or a swallowed rejection, so
 * callers can `instanceof` / switch on `.code` reliably.
 */

export type OpenPencilErrorCode =
  | 'CONNECTION_FAILED'
  | 'PAGE_LOAD_FAILED'
  | 'NOT_READY'
  | 'HUB_START_FAILED'
  | 'AUTH_REJECTED'
  | 'SESSION_DISCONNECTED'
  | 'REQUEST_TIMEOUT'
  | 'AI_NOT_CONFIGURED'
  | 'AI_REQUEST_FAILED'
  | 'AI_REQUEST_IN_PROGRESS'
  | 'AI_CONFIGURE_FAILED'
  | 'DOWNLOAD_FAILED'
  | 'PROTOCOL_ERROR'
  | 'UNSUPPORTED_ACTION'
  | 'BROWSER_CRASHED'
  | 'CLUSTER_ERROR'
  | 'INVALID_PAYLOAD'
  | 'CLIENT_CLOSED'

export class OpenPencilAutomationError extends Error {
  readonly code: OpenPencilErrorCode

  constructor(code: OpenPencilErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'OpenPencilAutomationError'
    this.code = code
  }
}

export function toAutomationError(
  code: OpenPencilErrorCode,
  error: unknown,
  fallbackMessage: string
): OpenPencilAutomationError {
  if (error instanceof OpenPencilAutomationError) return error
  const message = error instanceof Error ? error.message : fallbackMessage
  return new OpenPencilAutomationError(code, message, { cause: error })
}

/** Narrow a remote (browser-reported) error code onto our error taxonomy. */
export function remoteErrorCodeToLocal(code: string): OpenPencilErrorCode {
  switch (code) {
    case 'AI_NOT_CONFIGURED':
    case 'AI_REQUEST_FAILED':
    case 'AI_REQUEST_IN_PROGRESS':
    case 'AI_CONFIGURE_FAILED':
    case 'UNSUPPORTED_ACTION':
    case 'INVALID_PAYLOAD':
      return code
    case 'FIG_EXPORT_FAILED':
      return 'DOWNLOAD_FAILED'
    default:
      return 'PROTOCOL_ERROR'
  }
}
