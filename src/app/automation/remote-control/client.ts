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
import z from 'zod'
import { handleAIRequest } from '@/app/automation/remote-control/handlers/ai'
import { handleAIConfigure } from '@/app/automation/remote-control/handlers/configure'
import { handleFigDownload } from '@/app/automation/remote-control/handlers/fig'

export type RemoteControlQueryParams = Record<string, string | string[] | null | undefined>

const queryString = z.preprocess(
  (value) => (Array.isArray(value) ? value[0] : value),
  z.string().min(1)
)

const queryPort = z.preprocess(
  (value) => (Array.isArray(value) ? value[0] : value),
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(65535))
)

const remoteControlQuerySchema = z
  .object({
    'op-remote-control': queryString,
    'op-remote-control-host': queryString.default('127.0.0.1'),
    'op-remote-control-port': queryPort,
    'op-remote-control-token': queryString,
    'op-remote-control-session': queryString,
    'op-remote-control-sign': queryString
  })
  .transform((value) => ({
    enabled: value['op-remote-control'],
    host: value['op-remote-control-host'],
    port: value['op-remote-control-port'],
    token: value['op-remote-control-token'],
    sessionId: value['op-remote-control-session'],
    signature: value['op-remote-control-sign']
  }))

type RemoteControlConfig = z.infer<typeof remoteControlQuerySchema>

function readConfig(params: RemoteControlQueryParams): RemoteControlConfig | null {
  const result = remoteControlQuerySchema.safeParse(params)
  if (!result.success) {
    console.warn(
      '[RemoteControl] "op-remote-control" is set but connection parameters are missing or invalid; ' +
        'remote control stays disabled.'
    )
    return null
  }

  return result.data
}

export function connectRemoteControl(params: RemoteControlQueryParams): { disconnect: () => void } {
  const parsedConfig = readConfig(params)
  if (!parsedConfig) return { disconnect: () => {} }
  const config: RemoteControlConfig = parsedConfig

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
        enabled: config.enabled,
        token: config.token,
        host: config.host,
        port: config.port,
        sessionId: config.sessionId,
        protocolVersion: REMOTE_CONTROL_PROTOCOL_VERSION,
        signature: config.signature
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
