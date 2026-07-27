import type { Context } from "hono";

import { env } from "@/env.js";

export async function getFrontendUrlRoute(c: Context) {
  const designId = c.req.param("designId");
  if (!designId) {
    return c.json({ error: "designId is required" }, 400);
  }

  const isReadOnly = c.req.query("isReadOnly") === "true";
  const frontendUrl = new URL(env.FRONTEND_URL);
  frontendUrl.searchParams.set("design", designId);

  if (isReadOnly) {
    frontendUrl.searchParams.set("view", "readonly");
  }

  return c.json({
    designId,
    isReadOnly,
    url: frontendUrl.toString(),
  });
}
