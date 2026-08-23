import type { Context } from "hono";
import type z from "zod";

import { enqueueGenerateRequest } from "@/queue/generate-worker.js";
import type { generateBodySchema } from "@/schemas";

export async function generateRoute(c: Context) {
  const body = await c.req.json<z.infer<typeof generateBodySchema>>().catch(() => null);
  if (!body?.prompt) {
    return c.json({ error: "prompt is required" }, 400);
  }

  try {
    const result = await enqueueGenerateRequest(body);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process generation request";
    console.error("[generate-route] failed to enqueue request", {
      error: message,
      designId: body.designId ?? null,
    });
    return c.json({ error: message }, 500);
  }
}
