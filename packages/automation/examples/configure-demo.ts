/**
 * Custom model / endpoint configuration demo.
 *
 * Shows setting the provider, model, custom endpoint, and token
 * programmatically instead of via .env — useful when different sessions
 * need different models (e.g. A/B comparing two providers).
 *
 * Run:
 *   cd packages/automation
 *   bun run examples/configure-demo.ts
 */
import { OpenPencilAutomation } from '../src/index'

async function main() {
  const client = await OpenPencilAutomation.connect({
    // Don't auto-configure from env for this demo; each session below sets
    // its own model explicitly instead.
    aiModel: null
  })

  try {
    // Session A: a named provider (Anthropic direct).
    const sessionA = await client.createSession({
      aiModel: {
        providerID: 'anthropic',
        modelID: 'claude-sonnet-4-6-20260301',
        apiKey: process.env.ANTHROPIC_API_KEY ?? 'sk-ant-...'
      }
    })

    // Session B: a fully custom / self-hosted OpenAI-compatible endpoint.
    const sessionB = await client.createSession({
      aiModel: {
        providerID: 'openai-compatible',
        customBaseURL: 'https://my-llm-gateway.internal/v1',
        customModelID: 'my-org/design-model-v2',
        apiKey: process.env.GATEWAY_TOKEN ?? 'my-gateway-token',
        name: 'Internal gateway'
      }
    })

    const prompt = 'Create a simple contact form with name, email, and message fields.'
    const [resultA, resultB] = await Promise.all([
      sessionA.sendAI({ prompt }),
      sessionB.sendAI({ prompt })
    ])

    console.log('Session A (Anthropic):', resultA.usage)
    console.log('Session B (custom endpoint):', resultB.usage)

    await Promise.all([sessionA.close(), sessionB.close()])
  } finally {
    await client.close()
  }
}

main().catch((error) => {
  console.error('Configure demo failed:', error)
  process.exitCode = 1
})
