import type { Context } from 'hono'

import { serializeDocument } from '@/document.js'
import { markSaved, getSession } from '@/session-manager.js'
import { putDesignBytes } from '@/storage/s3.js'
import { upsertDesignMetadata } from '@/storage/metadata.js'

export async function saveRoute(c: Context) {
  const uuid = c.req.param('uuid')
  if (!uuid) return c.json({ error: 'uuid is required' }, 400)
  const session = getSession(uuid)
  if (!session) {
    return c.json({ error: `No active session for ${uuid}. Generate first, then save.` }, 404)
  }

  const bytes = await serializeDocument(session.doc.graph)
  await putDesignBytes(uuid, bytes)
  await upsertDesignMetadata({
    id: uuid,
    promptHistory: session.messages,
    s3Key: `designs/${uuid}.fig`
  })
  markSaved(uuid)

  return c.json({ designId: uuid, savedBytes: bytes.byteLength })
}
