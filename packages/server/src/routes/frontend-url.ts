import type { Context } from "hono";

import { createSignedDesignUrl } from "@/design-auth.js";
import { getDb } from "@/db/index.js";
import { env } from "@/env.js";

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
  const frontendUrl = new URL(env.FRONTEND_URL);
  frontendUrl.searchParams.set("design", designId);
  frontendUrl.searchParams.set("key", signedAccess.accessKey);
  frontendUrl.searchParams.set("expiry", String(signedAccess.expiresAt));
  frontendUrl.searchParams.set("permission", signedAccess.permission);
  frontendUrl.searchParams.set("sign", signedAccess.signature);

  return c.json({
    designId,
    permission,
    url: frontendUrl.toString(),
  });
}
