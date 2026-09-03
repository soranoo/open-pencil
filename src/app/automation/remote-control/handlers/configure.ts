/**
 * Remote-control handler for `ai.configure`.
 *
 * Lets a server-side caller point Open-Pencil's *existing* AI chat at a
 * custom provider/model/endpoint/token without touching the Settings UI.
 * Reuses the same model-settings store the Settings dialog writes to
 * (`@/app/ai/models` — `saveModelProfileDraft` / `setModelRoleAssignment`)
 * and the same credential path `ChatPanel.vue`'s API-key field uses
 * (`useAIChat().setAPIKey`), so there is no second/parallel config system.
 *
 * `providerID: 'openai-compatible'` or `'anthropic-compatible'` combined
 * with `customBaseURL` is how a fully custom endpoint (self-hosted / proxy)
 * is configured; named providers (`'openai'`, `'anthropic'`, `'google'`,
 * `'deepseek'`, `'zai'`, `'minimax'`, `'openrouter'`) ignore `customBaseURL`.
 */
import { AI_PROVIDERS, type AIProviderID } from '@open-pencil/core/constants'

import { useAIChat } from '@/app/ai/chat/use'
import { createModelProfileDraft, saveModelProfileDraft, setModelRoleAssignment } from '@/app/ai/models'

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

function isKnownProviderID(value: string): value is AIProviderID {
  return value.startsWith('acp:') || AI_PROVIDERS.some((provider) => provider.id === value)
}

export async function handleAIConfigure(payload: AIConfigurePayload): Promise<AIConfigureResult> {
  if (!payload || typeof payload.providerID !== 'string' || !payload.providerID) {
    throw Object.assign(new Error('"providerID" is required (e.g. "openai-compatible")'), {
      code: 'INVALID_PAYLOAD'
    })
  }
  if (!isKnownProviderID(payload.providerID)) {
    const known = AI_PROVIDERS.map((provider) => provider.id).join(', ')
    throw Object.assign(new Error(`Unknown providerID "${payload.providerID}". Known providers: ${known}`), {
      code: 'INVALID_PAYLOAD'
    })
  }

  const draft = createModelProfileDraft()
  draft.providerID = payload.providerID
  draft.name = payload.name?.trim() || `Automation (${payload.providerID})`
  draft.capabilities = ['tools']
  if (payload.modelID !== undefined) draft.modelID = payload.modelID
  if (payload.customModelID !== undefined) draft.customModelID = payload.customModelID
  if (payload.customBaseURL !== undefined) draft.customBaseURL = payload.customBaseURL
  if (payload.customAPIType) draft.customAPIType = payload.customAPIType
  if (payload.maxOutputTokens) draft.maxOutputTokens = payload.maxOutputTokens

  let profile: ReturnType<typeof saveModelProfileDraft>
  try {
    profile = saveModelProfileDraft(draft)
  } catch (error) {
    throw Object.assign(
      new Error(error instanceof Error ? error.message : 'Failed to save model configuration'),
      { code: 'AI_CONFIGURE_FAILED' }
    )
  }

  setModelRoleAssignment('design', profile.id)

  const { setAPIKey } = useAIChat()
  if (payload.apiKey) {
    try {
      await setAPIKey(payload.apiKey)
    } catch (error) {
      throw Object.assign(
        new Error(error instanceof Error ? error.message : 'Failed to store API key'),
        { code: 'AI_CONFIGURE_FAILED' }
      )
    }
  }

  return {
    profileId: profile.id,
    connectionId: profile.connectionId,
    providerID: payload.providerID,
    effectiveModel: profile.customModelID || profile.modelID
  }
}
