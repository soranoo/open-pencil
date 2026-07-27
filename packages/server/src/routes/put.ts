import type { Context } from "hono";

import { getDb } from "@/db/index.js";
import { loadDocument } from "@/document.js";
import { markSaved } from "@/session-manager.js";
import { getStorage } from "@/storage/index.js";
/**
 * Companion to POST /designs/:designId/save. That route serializes a session this server
 * already has in memory (from a prior /generate call). This route instead accepts bytes
 * the *browser* is holding — needed because once a design is loaded into the app and a
 * person edits it by hand, this server has no idea those edits happened. The client's
 * server-bridge.ts calls this on "Save to server".
 */
export async function putDesignRoute(c: Context) {
  const { designId } = c.req.param();
  if (!designId) {
    return c.json({ error: "designId is required" }, 400);
  }

  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0) {
    return c.json({ error: "empty body" }, 400);
  }

  const uint8Bytes = new Uint8Array(bytes);

  try {
    await loadDocument(uint8Bytes);
  } catch (err) {
    return c.json(
      {
        error: `Uploaded bytes are not a valid document: ${(err as Error).message}`,
      },
      400,
    );
  }

  await getStorage().put(designId, uint8Bytes);

  const db = getDb();
  const existing = await db.getDesignMetadata(designId);

  await db.upsertDesignMetadata({
    id: designId,
    promptHistory: existing?.promptHistory ?? [],
    s3Key: `designs/${designId}.fig`,
  });

  await markSaved(designId);

  return c.json({
    designId: designId,
    savedBytes: uint8Bytes.byteLength,
  });
}
