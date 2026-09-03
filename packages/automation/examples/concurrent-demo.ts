/**
 * Concurrent design generation demo.
 *
 * Opens several independent, isolated browser sessions (each its own
 * puppeteer-cluster browser context, each with its own remote-control hub
 * connection) and drives them in parallel with Promise.all. Useful for
 * batch-generating multiple designs at once.
 *
 * Run:
 *   cd packages/automation
 *   cp .env.example .env   # first time only
 *   bun run demo:concurrent
 */
import { OpenPencilAutomation } from '../src/index'

const prompts = [
  'Create a minimalist portfolio homepage for a photographer.',
  'Create a pricing page with three tiers: Free, Pro, and Enterprise.',
  'Create a mobile app onboarding screen with a progress indicator.'
]

async function main() {
  const client = await OpenPencilAutomation.connect({ concurrency: prompts.length })

  try {
    console.log(`Opening ${prompts.length} concurrent sessions...`)
    const sessions = await Promise.all(prompts.map(() => client.createSession()))

    console.log('Running AI requests in parallel...\n')
    const results = await Promise.allSettled(
      sessions.map(async (session, index) => {
        const prompt = prompts[index]
        const { result, figFile } = await session.generate({
          prompt,
          download: { saveToPath: `./output-${index}.fig` }
        })
        return { prompt, result, figFile }
      })
    )

    results.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') {
        const { prompt, result, figFile } = outcome.value
        console.log(`[${index}] "${prompt}"`)
        console.log(`  -> ${result.text.length} chars, usage:`, result.usage)
        console.log(`  -> saved ${figFile.filename} (${figFile.byteLength} bytes)`)
      } else {
        console.error(`[${index}] failed:`, outcome.reason)
      }
    })
  } finally {
    await client.close()
    console.log('Closed.')
  }
}

main().catch((error) => {
  console.error('Concurrent demo failed:', error)
  process.exitCode = 1
})
