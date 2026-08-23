/**
 * Basic usage demo.
 *
 * Prerequisites:
 *   1. Open-Pencil dev server running:      bun run dev   (from the repo root)
 *   2. An AI provider configured either in that browser profile (Settings ->
 *      AI), or via the OPENPENCIL_AI_* env vars in .env — see .env.example.
 *      If both OPENPENCIL_AI_PROVIDER and OPENPENCIL_AI_TOKEN are set,
 *      OpenPencilAutomation.connect() configures every session automatically
 *      before any prompt is sent, so no manual UI step is needed.
 *
 * Run:
 *   cd packages/automation
 *   cp .env.example .env   # first time only
 *   bun run demo
 */
import { OpenPencilAutomation } from '../src/index'

async function main() {
  console.log('Connecting to Open-Pencil...')
  const client = await OpenPencilAutomation.connect({
    // url, headless, viewport, timeouts, aiModel, etc. all fall back to
    // .env / defaults. Override anything here instead of using env vars:
    // url: 'http://localhost:1420',
    // headless: false,
    // aiModel: { providerID: 'openai-compatible', customBaseURL: '...', customModelID: '...', apiKey: '...' },
  })

  try {
    console.log('Sending AI design request...\n')

    // Each sendAI() call gets a clean chat context by default (no leftover
    // conversation history from a previous run) — pass `continueSession: true`
    // for an intentional multi-turn follow-up on the same design instead.
    const { result, figFile } = await client.generate({
      prompt: 'Create a modern SaaS landing page with a hero section, three feature cards, and a footer.',
      download: { saveToPath: './output.fig' },
      onEvent: (event) => {
        switch (event.type) {
          case 'start':
            console.log(`[ai] started: "${event.prompt}"`)
            break
          case 'delta':
            process.stdout.write(event.textDelta)
            break
          case 'done':
            console.log('\n[ai] done')
            break
        }
      }
    })

    console.log('\n--- Final result ---')
    console.log('Finish reason:', result.finishReason)
    console.log('Token usage:', result.usage)

    console.log(`Saved ${figFile.filename} (${figFile.byteLength} bytes) to ./output.fig`)
  } finally {
    await client.close()
    console.log('\nClosed.')
  }
}

main().catch((error) => {
  console.error('Demo failed:', error)
  process.exitCode = 1
})
