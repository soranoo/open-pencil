/**
 * Remote-control handler for `ai.request`.
 *
 * Deliberately thin: it does not implement a second AI pipeline. It drives
 * the *same* chat session manager (`useAIChat` / `ensureChat` / `Chat` from
 * `@ai-sdk/vue`) that `ChatPanel.vue` uses, and reads token-usage totals from
 * the same per-store run-state module (`@/app/ai/tools`) that already backs
 * the in-app debug log. See src/components/ChatPanel.vue for the reference
 * implementation this mirrors.
 */
import { watch } from 'vue'
import type { UIMessage } from 'ai'

import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { useAIChat } from '@/app/ai/chat/use'
import { didHitStepLimit, getStepUsages, getToolLogEntries } from '@/app/ai/tools'
import { getActiveEditorStore } from '@/app/editor/active-store'

import type { AIRequestPayload, AIRequestResult } from '@open-pencil/automation/protocol'

type RemoteControlEventEmitter = (event: string, payload: unknown) => void

function extractAssistantText(message: UIMessage | undefined): string {
  if (!message || message.role !== 'assistant') return ''
  let text = ''
  for (const part of message.parts) {
    const p = part as JSONObject
    if (p.type === 'text' && typeof p.text === 'string') text += p.text
  }
  return text
}

function isRequestPending(status: string): boolean {
  return status === 'submitted' || status === 'streaming'
}

export async function handleAIRequest(
  payload: AIRequestPayload,
  emit: RemoteControlEventEmitter
): Promise<AIRequestResult> {
  const prompt = payload?.prompt
  if (!prompt || typeof prompt !== 'string') {
    throw Object.assign(new Error('Missing "prompt" in ai.request payload'), {
      code: 'INVALID_PAYLOAD'
    })
  }

  const { isConfigured, ensureChat, resetChat, activeTab } = useAIChat()
  if (!isConfigured.value) {
    throw Object.assign(
      new Error(
        'No AI provider is configured in this Open-Pencil session. Configure an API key in ' +
          'Settings (or send an "ai.configure" command before "ai.request") and retry.'
      ),
      { code: 'AI_NOT_CONFIGURED' }
    )
  }

  // Each generation gets a clean context by default so concurrent/sequential
  // sendAI calls never leak prior conversation into each other — pass
  // `continueSession: true` for an intentional multi-turn follow-up instead.
  if (!payload.continueSession) resetChat()

  const chat = await ensureChat()
  if (!chat) {
    throw Object.assign(new Error('Chat session unavailable'), { code: 'AI_NOT_CONFIGURED' })
  }

  if (isRequestPending(chat.status)) {
    throw Object.assign(new Error('A request is already in progress for this session'), {
      code: 'AI_REQUEST_IN_PROGRESS'
    })
  }

  const store = getActiveEditorStore()
  const toolLogStart = getToolLogEntries(store).length
  let emittedLength = 0

  // `chat.messages` is reactive (Vue), same as `messages` in ChatPanel.vue.
  // We stream deltas for the *new* assistant message as it grows.
  const stopWatch = watch(
    () => chat.messages,
    (messages) => {
      const last = messages[messages.length - 1]
      const text = extractAssistantText(last)
      if (text.length > emittedLength) {
        emit('stream', {
          textDelta: text.slice(emittedLength),
          textSoFar: text,
          done: false
        })
        emittedLength = text.length
      }
    },
    { deep: true }
  )

  // Sync to the visible UI: switch the properties-panel sidebar to the AI
  // tab (same ref PropertiesPanel.vue's TabsRoot v-models to) so a headful
  // run shows the conversation live, the same as a user clicking into it.
  activeTab.value = 'ai'

  emit('start', { prompt })

  try {
    await chat.sendMessage({ text: prompt })
  } catch (error) {
    throw Object.assign(
      new Error(error instanceof Error ? error.message : 'AI request failed'),
      { code: 'AI_REQUEST_FAILED' }
    )
  } finally {
    stopWatch()
  }

  const finalMessage = chat.messages[chat.messages.length - 1]
  const text = extractAssistantText(finalMessage)

  // Emit one final stream event so consumers see a clean done:true terminator
  // even if the last delta was already flushed above.
  emit('stream', { textDelta: '', textSoFar: text, done: true })

  const steps = getStepUsages(store)
  const usage = steps.reduce(
    (acc, step) => ({
      inputTokens: acc.inputTokens + step.inputTokens,
      outputTokens: acc.outputTokens + step.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + step.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens + step.cacheWriteTokens
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  )
  const toolCalls = [
    ...getToolLogEntries(store)
      .slice(toolLogStart)
      .map((entry) => ({ tool: entry.tool, mutates: entry.mutates }))
  ]

  return {
    text,
    finishReason: finalMessage?.role === 'assistant' ? 'stop' : 'unknown',
    usage: { ...usage, totalTokens: usage.inputTokens + usage.outputTokens },
    toolCalls,
    hitStepLimit: didHitStepLimit(store)
  }
}
