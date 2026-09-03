import type { Context } from "hono";

import { getGenerateRequestStatus } from "@/queue/generate-worker.js";

export async function generateStatusRoute(c: Context) {
  const requestId = c.req.param("requestId");
  if (!requestId) {
    return c.json({ error: "requestId is required" }, 400);
  }

  const status = await getGenerateRequestStatus(requestId);
  if (!status) {
    return c.json({ error: `No queued request found for ${requestId}` }, 404);
  }

  return c.json(status);
}
