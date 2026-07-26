import type { Context } from 'hono'

import { runPrompt } from '../chat-engine.js'
import { loadDocument } from '../document.js'
import { env } from '../env.js'
import { getDesignBytes } from '../storage/s3.js'
import { createSession, getSession } from '../session-manager.js'

interface GenerateBody {
  prompt: string
  designId?: string
}

export async function generateRoute(c: Context) {
  const body = await c.req.json<GenerateBody>().catch(() => null)
  if (!body?.prompt) {
    return c.json({ error: 'prompt is required' }, 400)
  }

  // Resolve or create the session:
  //   - designId provided + already warm in memory -> reuse it (multi-turn refinement)
  //   - designId provided + not in memory -> pull bytes from S3 and rehydrate
  //   - no designId -> brand-new blank document, fresh UUID
  let session = body.designId ? getSession(body.designId) : undefined
  if (!session && body.designId) {
    const bytes = await getDesignBytes(body.designId).catch(() => null)
    if (!bytes) return c.json({ error: `No saved design found for ${body.designId}` }, 404)
    const doc = await loadDocument(bytes)
    session = createSession(doc, body.designId)
  }
  if (!session) {
    session = createSession()
  }

  const result = await runPrompt(
    session.doc,
    {
      providerID: env.ai.providerID as never,
      apiKey: env.ai.apiKey,
      modelID: env.ai.modelID,
      customModelID: env.ai.customModelID,
      customBaseURL: env.ai.customBaseURL,
      customAPIType: env.ai.customAPIType
    },
    body.prompt,
    session.messages
  )

  session.messages = result.messages

  return c.json({
    designId: session.id,
    summary: result.text,
    toolCallCount: result.toolLog.length,
    hitStepLimit: result.hitStepLimit,
    // Handy for a caller building their own progress UI without needing SSE.
    toolLog: result.toolLog.map((entry) => ({ tool: entry.tool, mutates: entry.mutates }))
  })
}
