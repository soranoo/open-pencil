import type { Context } from "hono";

import { GENERATE_QUEUE_NAME, getGenerateQueueSize } from "@/queue/generate-worker.js";

export async function queueSizeRoute(c: Context) {
  const size = await getGenerateQueueSize();
  return c.json({ queue: GENERATE_QUEUE_NAME, size });
}
