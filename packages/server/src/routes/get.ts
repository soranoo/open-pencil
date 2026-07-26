import type { Context } from 'hono'

import { getDesignMetadata } from '../storage/metadata.js'
import { getDesignBytes } from '../storage/s3.js'

export async function getDesignRoute(c: Context) {
  const uuid = c.req.param('uuid')
  if (!uuid) return c.json({ error: 'uuid is required' }, 400)

  const metadata = await getDesignMetadata(uuid)
  if (!metadata) return c.json({ error: `No saved design found for ${uuid}` }, 404)

  const bytes = await getDesignBytes(uuid)
  console.log({bytes})

  // Raw bytes by default so the forked web client can pipe this straight into its
  // existing "open .fig file" import path. Add ?format=json if you'd rather return
  // base64 + metadata in one payload for a non-file-based client.
  if (c.req.query('format') === 'json') {
    return c.json({
      designId: uuid,
      metadata,
      dataBase64: Buffer.from(bytes).toString('base64')
    })
  }

  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${uuid}.fig"`
    }
  })
}
