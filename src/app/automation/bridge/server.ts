import type {
  RemoteControlEvent,
  RemoteControlModel
} from '@open-pencil/automation/protocol'
import { encodeBase64 } from '@open-pencil/core/bytes'
/**
 * Browser-side automation handler.
 *
 * Connects to the bridge via WebSocket, receives RPC requests,
 * executes them against the live EditorStore, and sends results back.
 */
import { randomHex } from '@open-pencil/core/random'

import { useAIChat } from '@/app/ai/chat/use'
import { replaceAIModelSettings } from '@/app/ai/models'
import type { AIModelSettings } from '@/app/ai/models/types'
import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { createAutomationCommandHandlers } from '@/app/automation/bridge/handlers'
import type { EditorStore } from '@/app/editor/active-store'

export function connectAutomation(
  getStore: () => EditorStore,
  authToken: string | null = null,
  automationURL = __OPENPENCIL_LOCAL_AUTOMATION_URL__
) {
  const token = authToken ?? randomHex(32)
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let intentionalDisconnect = false

  const { handleRequest: handleAutomationRequest } =
    createAutomationCommandHandlers(makeFigmaFromStore)
  const { sendAI, setAPIKey } = useAIChat()

  function sendEvent(socket: WebSocket, event: RemoteControlEvent) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event))
  }

  async function handleRequest(
    socket: WebSocket,
    id: string,
    command: string,
    args: unknown
  ): Promise<unknown> {
    if (command === 'send_ai_input') {
      const request = args as { prompt?: unknown; model?: RemoteControlModel }
      const prompt = request.prompt
      if (typeof prompt !== 'string' || prompt.trim() === '') {
        throw new Error('Missing "prompt" in args')
      }
      if (request.model) {
        replaceAIModelSettings(request.model.settings as AIModelSettings)
        if (typeof request.model.apiKey === 'string') await setAPIKey(request.model.apiKey)
      }
      sendEvent(socket, { type: 'event', event: 'ai.started', requestId: id })
      try {
        const result = await sendAI(prompt, (update) => {
          sendEvent(socket, {
            type: 'event',
            event: update.done ? 'ai.completed' : 'ai.stream',
            requestId: id,
            content: update.content,
            done: update.done,
            usage: update.usage
          })
        })
        return { ok: true, result }
      } catch (error) {
        sendEvent(socket, {
          type: 'event',
          event: 'ai.failed',
          requestId: id,
          error: error instanceof Error ? error.message : String(error),
          done: true
        })
        throw error
      }
    }

    if (command === 'download_fig') {
      const data = await getStore().getFigFile()
      return {
        ok: true,
        result: { base64: encodeBase64(data), fileName: `${getStore().state.documentName}.fig` }
      }
    }

    return handleAutomationRequest(getStore(), command, args)
  }

  function connect() {
    let socket: WebSocket
    try {
      socket = new WebSocket(automationURL)
      ws = socket
    } catch (e) {
      console.error(
        '[Automation] WebSocket constructor failed:',
        e instanceof Error ? e.message : e
      )
      scheduleReconnect()
      return
    }

    socket.onopen = () => {
      console.debug('[Automation] WebSocket connected to MCP server')
      socket.send(JSON.stringify({ type: 'register', token }))
    }

    socket.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data) as {
          type: string
          id: string
          command: string
          args?: unknown
        }
        if (msg.type !== 'request' || !msg.id) return
        try {
          const result = await handleRequest(socket, msg.id, msg.command, msg.args)
          if (socket.readyState !== WebSocket.OPEN) return
          socket.send(JSON.stringify({ type: 'response', id: msg.id, ...(result as object) }))
        } catch (e) {
          if (socket.readyState !== WebSocket.OPEN) return
          socket.send(
            JSON.stringify({
              type: 'response',
              id: msg.id,
              ok: false,
              error: e instanceof Error ? e.message : String(e)
            })
          )
        }
      } catch (e) {
        console.warn('Failed to parse WebSocket message:', e)
      }
    }

    socket.onclose = (event) => {
      if (ws === socket) ws = null
      if (intentionalDisconnect || event.code === 1000) return
      console.warn('[Automation] WebSocket closed:', `code=${event.code} reason=${event.reason}`)
      scheduleReconnect()
    }

    socket.onerror = (event) => {
      console.warn('[Automation] WebSocket error:', event)
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
  return { disconnect, token }
}
