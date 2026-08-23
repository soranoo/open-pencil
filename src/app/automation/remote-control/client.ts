/**
 * Browser-side remote-control client.
 *
 * Mirrors the existing MCP automation bridge
 * (`src/app/automation/bridge/server.ts`): the browser is the WebSocket
 * *client*, dialing out to a small Node hub, registering with a token, then
 * executing commands the hub sends and replying with results/events. Kept
 * as a separate, self-contained module rather than folding into the MCP
 * bridge because the two serve different protocols (generic Figma-style RPC
 * vs. streaming AI + file download) and this keeps the existing MCP/Claude
 * Desktop integration completely untouched.
 *
 * Only active when the page was navigated to with the `op-remote-control`
 * query param set (done by the `@open-pencil/automation` package when it
 * drives the browser). In normal interactive use this module does nothing.
 */
import {
  REMOTE_CONTROL_PROTOCOL_VERSION,
  type CommandMessage,
  type EventMessage,
  type HelloMessage,
  type ResultMessage
} from '@open-pencil/automation/protocol'
import { handleAIRequest } from '@/app/automation/remote-control/handlers/ai'
import { handleAIConfigure } from '@/app/automation/remote-control/handlers/configure'
import { handleFigDownload } from '@/app/automation/remote-control/handlers/fig'

export type RemoteControlQueryParams = Record<string, string | string[] | null | undefined>

interface RemoteControlConfig {
  host: string
  port: string
  token: string
  sessionId: string
}

function firstValue(value: string | string[] | null | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value ?? undefined
}

function readConfig(params: RemoteControlQueryParams): RemoteControlConfig | null {
  if (!firstValue(params['op-remote-control'])) return null

  const port = firstValue(params['op-remote-control-port'])
  const token = firstValue(params['op-remote-control-token'])
  const sessionId = firstValue(params['op-remote-control-session'])
  const host = firstValue(params['op-remote-control-host']) ?? '127.0.0.1'

  if (!port || !token || !sessionId) {
    console.warn(
      '[RemoteControl] "op-remote-control" is set but port/token/session params are missing; ' +
        'remote control stays disabled.'
    )
    return null
  }

  return { host, port, token, sessionId }
}

export function connectRemoteControl(params: RemoteControlQueryParams): { disconnect: () => void } {
  const config = readConfig(params)
  if (!config) return { disconnect: () => {} }

  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let intentionalDisconnect = false

  function send(message: unknown) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
  }

  function emitEvent(id: string, action: string, event: string, payload: unknown) {
    const message: EventMessage = { type: 'event', id, action, event, payload }
    send(message)
  }

  function sendResult(id: string, result: unknown) {
    const message: ResultMessage = { type: 'result', id, ok: true, result }
    send(message)
  }

  function sendError(id: string, error: unknown) {
    const message: ResultMessage = {
      type: 'result',
      id,
      ok: false,
      error: {
        code: (error as { code?: string })?.code ?? 'HANDLER_ERROR',
        message: error instanceof Error ? error.message : String(error)
      }
    }
    send(message)
  }

  async function dispatch(cmd: CommandMessage) {
    try {
      switch (cmd.action) {
        case 'ping':
          sendResult(cmd.id, { pong: true, time: Date.now() })
          return
        case 'ai.request':
          sendResult(
            cmd.id,
            await handleAIRequest(cmd.payload as { prompt: string }, (event, payload) =>
              emitEvent(cmd.id, cmd.action, event, payload)
            )
          )
          return
        case 'ai.configure':
          sendResult(cmd.id, await handleAIConfigure(cmd.payload as { providerID: string }))
          return
        case 'fig.download':
          sendResult(cmd.id, await handleFigDownload())
          return
        default:
          throw Object.assign(new Error(`Unsupported action: "${cmd.action}"`), {
            code: 'UNSUPPORTED_ACTION'
          })
      }
    } catch (error) {
      sendError(cmd.id, error)
    }
  }

  function connect() {
    let socket: WebSocket
    try {
      socket = new WebSocket(`ws://${config.host}:${config.port}`)
      ws = socket
    } catch (e) {
      console.error(
        '[RemoteControl] WebSocket constructor failed:',
        e instanceof Error ? e.message : e
      )
      scheduleReconnect()
      return
    }

    socket.onopen = () => {
      const hello: HelloMessage = {
        type: 'hello',
        token: config.token,
        sessionId: config.sessionId,
        protocolVersion: REMOTE_CONTROL_PROTOCOL_VERSION
      }
      socket.send(JSON.stringify(hello))
      console.debug('[RemoteControl] Connected to hub, registered session', config.sessionId)
    }

    socket.onmessage = (event) => {
      let msg: CommandMessage
      try {
        msg = JSON.parse(event.data as string) as CommandMessage
      } catch (e) {
        console.warn('[RemoteControl] Failed to parse message from hub:', e)
        return
      }
      if (msg?.type !== 'cmd' || !msg.id) return
      void dispatch(msg)
    }

    socket.onclose = (event) => {
      if (ws === socket) ws = null
      if (intentionalDisconnect || event.code === 1000) return
      console.warn('[RemoteControl] WebSocket closed:', `code=${event.code} reason=${event.reason}`)
      scheduleReconnect()
    }

    socket.onerror = (event) => {
      console.warn('[RemoteControl] WebSocket error:', event)
      socket.close()
    }
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(connect, 2000)
  }

  function disconnect() {
    intentionalDisconnect = true
    clearTimeout(reconnectTimer)
    ws?.close()
    ws = null
  }

  connect()
  return { disconnect }
}
