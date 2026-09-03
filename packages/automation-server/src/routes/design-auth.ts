import type { Context } from "hono";

import { authenticateDesignAccess, getDesignCookieRefreshIntervalMs } from "@/design-auth.js";

export async function designAuthRoute(c: Context) {
  const designId = c.req.param("designId");
  if (!designId) {
    return c.json({ error: "designId is required" }, 400);
  }

  const session = await authenticateDesignAccess(c, designId);
  if (!session) {
    return c.json({ error: "Unauthorized or expired design access" }, 401);
  }

  return c.json({
    authenticated: true,
    designId,
    permission: session.permission,
    refreshIntervalMs: getDesignCookieRefreshIntervalMs(),
    cookieExpiresAt: session.expiresAt,
    source: session.source,
  });
}
