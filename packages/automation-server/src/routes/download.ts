import type { Context } from "hono";

import { getDb } from "@/db/index.js";
import { requireDesignAccess } from "@/design-auth.js";
import { getStorage } from "@/storage/index.js";

export async function downloadDesignRoute(c: Context) {
  const designId = c.req.param("designId");
  if (!designId) return c.json({ error: "designId is required" }, 400);

  const access = await requireDesignAccess(c, designId, "read");
  if (access instanceof Response) {
    return access;
  }

  const metadata = await getDb().getDesignMetadata(designId);
  if (!metadata) return c.json({ error: `No saved design found for ${designId}` }, 404);

  const bytes = await getStorage().get(designId);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${designId}.fig"`,
    },
  });
}
