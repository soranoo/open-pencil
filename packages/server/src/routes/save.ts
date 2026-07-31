import type { Context } from "hono";

import { ActiveSessionNotFoundError, saveDesignSession } from "@/design-save.js";

export async function saveRoute(c: Context) {
  const designId = c.req.param("designId");
  if (!designId) {
    return c.json({ error: "designId is required" }, 400);
  }

  try {
    return c.json(await saveDesignSession(designId));
  } catch (error) {
    if (error instanceof ActiveSessionNotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    throw error;
  }
}
