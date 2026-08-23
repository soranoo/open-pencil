import type { Context } from "hono";

import { getDb } from "@/db/index.js";
import { requireDesignAccess } from "@/design-auth.js";
import { getStorage } from "@/storage/index.js";

export async function getDesignRoute(c: Context) {
  const designId = c.req.param("designId");
  if (!designId) return c.json({ error: "designId is required" }, 400);

  const access = await requireDesignAccess(c, designId, "read");
  if (access instanceof Response) {
    return access;
  }

  const metadata = await getDb().getDesignMetadata(designId);
  if (!metadata) return c.json({ error: `No saved design found for ${designId}` }, 404);

  const bytes = await getStorage().get(designId);

  // Raw bytes by default so the forked web client can pipe this straight into its
  // existing "open .fig file" import path. Add ?format=json if you'd rather return
  // base64 + metadata in one payload for a non-file-based client.
  if (c.req.query("format") === "json") {
    return c.json({
      designId: designId,
      metadata,
      dataBase64: Buffer.from(bytes).toString("base64"),
    });
  }

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${designId}.fig"`,
    },
  });
}
