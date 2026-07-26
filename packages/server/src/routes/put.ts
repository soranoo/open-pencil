import type { Context } from "hono";

import { putDesignBytes } from "@/storage/s3.js";
import { getDesignMetadata, upsertDesignMetadata } from "@/storage/metadata.js";
import { markSaved } from "@/session-manager.js";

/**
 * Companion to POST /designs/:uuid/save. That route serializes a session this server
 * already has in memory (from a prior /generate call). This route instead accepts bytes
 * the *browser* is holding — needed because once a design is loaded into the app and a
 * person edits it by hand, this server has no idea those edits happened. The client's
 * server-bridge.ts calls this on "Save to server".
 */
export async function putDesignRoute(c: Context) {
  const uuid = c.req.param("uuid");
  if (!uuid) return c.json({ error: "uuid is required" }, 400);

  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength === 0) return c.json({ error: "empty body" }, 400);

  await putDesignBytes(uuid, bytes);

  // Preserve prompt history if this uuid already has a generation record; otherwise
  // this is a design that only ever existed client-side, saved to the server for the
  // first time.
  const existing = await getDesignMetadata(uuid);
  await upsertDesignMetadata({
    id: uuid,
    promptHistory: existing?.promptHistory ?? [],
    s3Key: `designs/${uuid}.fig`,
  });
  markSaved(uuid);

  return c.json({ designId: uuid, savedBytes: bytes.byteLength });
}
