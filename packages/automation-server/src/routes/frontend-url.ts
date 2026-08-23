import type { Context } from "hono";

import { createSignedDesignUrl, getSignedDesignUrl } from "@/design-auth.js";
import { getDb } from "@/db/index.js";

export async function getFrontendUrlRoute(c: Context) {
  const designId = c.req.param("designId");
  if (!designId) {
    return c.json({ error: "designId is required" }, 400);
  }

  const metadata = await getDb().getDesignMetadata(designId);
  if (!metadata) {
    return c.json({ error: `No saved design found for ${designId}` }, 404);
  }

  const permission = c.req.query("permission") === "write" ? "write" : "read";
  const signedAccess = createSignedDesignUrl(designId, permission);

  return c.json({
    designId,
    permission,
    url: getSignedDesignUrl(signedAccess),
  });
}
