import { randomUUID } from 'node:crypto'

import { WebSocket, WebSocketServer } from 'ws'

import { OpenPencilAutomationError, remoteErrorCodeToLocal } from './errors'
import {
  REMOTE_CONTROL_PROTOCOL_VERSION,
  type CommandMessage,
  type EventMessage,
  type HelloMessage,
  type RemoteControlAction,
  type ResultMessage
} from './protocol'

interface PendingCommand {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  onEvent?: (event: string, payload: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

interface SessionConnection {
  ws: WebSocket
  pending: Map<string, PendingCommand>
}

export interface HubOptions {
  host: string
  port: number
  token: string
}

/**
 * The "Open-Pencil Remote Control Hub" from the architecture diagram.
 *
 * Runs inside this Node package (not literally inside the browser — a page
 * cannot bind a TCP listener). The Open-Pencil frontend dials *out* to this
 * server (see `src/app/automation/remote-control/client.ts`), registers with
 * a shared token + a per-page session id, and from then on the hub can push
 * `cmd` messages to that specific browser session and correlate the
 * `event`/`result` messages it sends back — the same request/response +
 * token-auth shape already used by the existing MCP automation bridge
 * (`src/app/automation/bridge/server.ts`), extended here with a streaming
 * `event` message type.
 */
export class RemoteControlHub {
  private readonly host: string
  private readonly requestedPort: number
  private readonly token: string
  private wss: WebSocketServer | null = null
  private actualPort = 0
  private readonly sessions = new Map<string, SessionConnection>()
  private readonly registrationWaiters = new Map<string, Array<() => void>>()

  constructor(options: HubOptions) {
    this.host = options.host
    this.requestedPort = options.port
    this.token = options.token
  }

  get port(): number {
    return this.actualPort
  }

  get host_(): string {
    return this.host
  }

  async start(): Promise<{ host: string; port: number }> {
    await new Promise<void>((resolve, reject) => {
      let wss: WebSocketServer
      try {
        wss = new WebSocketServer({ host: this.host, port: this.requestedPort })
      } catch (error) {
        reject(
          new OpenPencilAutomationError(
            'HUB_START_FAILED',
            `Failed to construct remote-control hub server: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error }
          )
        )
        return
      }
      this.wss = wss

      const onError = (error: Error) => {
        reject(
          new OpenPencilAutomationError(
            'HUB_START_FAILED',
            `Failed to start remote-control hub on ${this.host}:${this.requestedPort}: ${error.message}. ` +
              'Is another instance already running on this port?',
            { cause: error }
          )
        )
      }
      wss.once('error', onError)

      wss.once('listening', () => {
        wss.off('error', onError)
        const address = wss.address()
        this.actualPort = typeof address === 'object' && address ? address.port : this.requestedPort
        resolve()
      })

      wss.on('connection', (ws) => this.handleConnection(ws))
      wss.on('error', (error) => {
        console.warn('[Hub] WebSocket server error:', error.message)
      })
    })

    return { host: this.host, port: this.actualPort }
  }

  private handleConnection(ws: WebSocket): void {
    let sessionId: string | null = null
    let authenticated = false

    const authTimer = setTimeout(() => {
      if (!authenticated) ws.close(4001, 'auth timeout')
    }, 10_000)

    ws.on('message', (raw) => {
      let msg: HelloMessage | EventMessage | ResultMessage
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        console.warn('[Hub] Received malformed (non-JSON) message; ignoring')
        return
      }

      if (!authenticated) {
        if (msg.type !== 'hello') {
          console.warn(`[Hub] Expected "hello" as first message, got "${msg.type}"; closing`)
          ws.close(4002, 'expected hello')
          return
        }
        clearTimeout(authTimer)
        if (!msg.token || msg.token !== this.token) {
          ws.close(4003, 'invalid token')
          return
        }
        if (msg.protocolVersion !== REMOTE_CONTROL_PROTOCOL_VERSION) {
          console.warn(
            `[Hub] Session ${msg.sessionId} reports protocol v${msg.protocolVersion}, hub is v${REMOTE_CONTROL_PROTOCOL_VERSION}`
          )
        }
        authenticated = true
        sessionId = msg.sessionId
        this.sessions.set(sessionId, { ws, pending: new Map() })
        this.resolveRegistration(sessionId)
        return
      }

      if (!sessionId) return
      const session = this.sessions.get(sessionId)
      if (!session) return
      this.routeAuthenticatedMessage(session, msg)
    })

    ws.on('close', () => {
      clearTimeout(authTimer)
      if (!sessionId) return
      const session = this.sessions.get(sessionId)
      if (!session) return
      this.sessions.delete(sessionId)
      for (const pending of session.pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(
          new OpenPencilAutomationError(
            'SESSION_DISCONNECTED',
            'Browser session disconnected before the command completed'
          )
        )
      }
    })

    ws.on('error', (error) => {
      console.warn('[Hub] Browser WebSocket connection error:', error.message)
    })
  }

  private routeAuthenticatedMessage(
    session: SessionConnection,
    msg: HelloMessage | EventMessage | ResultMessage
  ): void {
    if (msg.type === 'hello') return // already authenticated; ignore repeats

    if (msg.type === 'event') {
      session.pending.get(msg.id)?.onEvent?.(msg.event, msg.payload)
      return
    }

    if (msg.type === 'result') {
      const pending = session.pending.get(msg.id)
      if (!pending) return
      clearTimeout(pending.timer)
      session.pending.delete(msg.id)
      if (msg.ok) {
        pending.resolve(msg.result)
      } else {
        const code = msg.error ? remoteErrorCodeToLocal(msg.error.code) : 'PROTOCOL_ERROR'
        pending.reject(new OpenPencilAutomationError(code, msg.error?.message ?? 'Remote command failed'))
      }
      return
    }

    console.warn(`[Hub] Unexpected message type "${(msg as { type: string }).type}"; ignoring`)
  }

  /** Resolves once the given session has completed the hello/auth handshake. */
  async waitForRegistration(sessionId: string, timeoutMs: number): Promise<void> {
    if (this.sessions.has(sessionId)) return
    return new Promise<void>((resolve, reject) => {
      const waiters = this.registrationWaiters.get(sessionId) ?? []

      const timer = setTimeout(() => {
        const index = waiters.indexOf(onReady)
        if (index >= 0) waiters.splice(index, 1)
        reject(
          new OpenPencilAutomationError(
            'NOT_READY',
            `Open-Pencil did not register with the remote-control hub within ${timeoutMs}ms ` +
              `(session ${sessionId}). Is the dev server running and reachable, and did the page load?`
          )
        )
      }, timeoutMs)

      const onReady = () => {
        clearTimeout(timer)
        resolve()
      }

      waiters.push(onReady)
      this.registrationWaiters.set(sessionId, waiters)
    })
  }

  private resolveRegistration(sessionId: string): void {
    const waiters = this.registrationWaiters.get(sessionId)
    if (!waiters) return
    this.registrationWaiters.delete(sessionId)
    for (const waiter of waiters) waiter()
  }

  isSessionConnected(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /** Send a command to a registered session and await its terminal result. */
  async sendCommand<TResult = unknown>(
    sessionId: string,
    action: RemoteControlAction,
    payload: unknown,
    options: { timeoutMs: number; onEvent?: (event: string, payload: unknown) => void }
  ): Promise<TResult> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new OpenPencilAutomationError(
        'SESSION_DISCONNECTED',
        `No registered browser session "${sessionId}" (page may have crashed or navigated away)`
      )
    }

    const id = randomUUID()
    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending.delete(id)
        reject(
          new OpenPencilAutomationError(
            'REQUEST_TIMEOUT',
            `Command "${action}" timed out after ${options.timeoutMs}ms`
          )
        )
      }, options.timeoutMs)

      session.pending.set(id, {
        resolve: (result) => resolve(result as TResult),
        reject,
        onEvent: options.onEvent,
        timer
      })

      const message: CommandMessage = { type: 'cmd', id, action, payload }
      try {
        session.ws.send(JSON.stringify(message))
      } catch (error) {
        clearTimeout(timer)
        session.pending.delete(id)
        reject(
          new OpenPencilAutomationError('SESSION_DISCONNECTED', 'Failed to send command to browser session', {
            cause: error
          })
        )
      }
    })
  }

  async stop(): Promise<void> {
    for (const session of this.sessions.values()) {
      for (const pending of session.pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(new OpenPencilAutomationError('CLIENT_CLOSED', 'Hub is shutting down'))
      }
      try {
        session.ws.close(1000, 'hub shutting down')
      } catch {
        // already closed; ignore
      }
    }
    this.sessions.clear()

    await new Promise<void>((resolve, reject) => {
      if (!this.wss) {
        resolve()
        return
      }
      this.wss.close((error) => (error ? reject(error) : resolve()))
    })
  }
}
