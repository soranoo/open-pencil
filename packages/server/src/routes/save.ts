import type { Context } from "hono";

import { getDb } from "@/db/index.js";
import { serializeDocument } from "@/document.js";
import { getSession, markSaved } from "@/session-manager.js";
import { getStorage } from "@/storage/index.js";

export async function saveRoute(c: Context) {
  const designId = c.req.param("designId");
  if (!designId) {
    return c.json({ error: "designId is required" }, 400);
  }
  const session = await getSession(designId);
  if (!session) {
    return c.json({ error: `No active session for ${designId}. Generate first, then save.` }, 404);
  }

  const bytes = await serializeDocument(session.doc.graph);
  await getStorage().put(designId, bytes);
  await getDb().upsertDesignMetadata({
    id: designId,
    promptHistory: session.messages,
    s3Key: `designs/${designId}.fig`,
  });
  await markSaved(designId);
  const fileToDelete = `temp/${designId}`;
  await getStorage()
    .delete(fileToDelete)
    .catch((e) => {
      console.error(`Failed to delete ${fileToDelete}, reason: ${e?.messages}`);
    });

  return c.json({ designId, savedBytes: bytes.byteLength });
}
