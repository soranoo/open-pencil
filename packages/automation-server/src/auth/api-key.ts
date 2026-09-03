import { createHash, timingSafeEqual } from "node:crypto";

import type { MiddlewareHandler } from "hono";

import { env } from "@/env.js";

function getBearerToken(value: string | undefined): string | null {
  if (!value) return null;
  const [scheme, token] = value.split(" ", 2);
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

function getRequestApiKey(request: Request): string | null {
  const bearerToken = getBearerToken(request.headers.get("authorization") ?? undefined);
  if (bearerToken) return bearerToken;

  const headerKey = request.headers.get("x-api-key");
  if (headerKey) return headerKey;

  return null;
}

function hashApiKey(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function isValidServerApiKey(value: string): boolean {
  return timingSafeEqual(hashApiKey(value), hashApiKey(env.SERVER_API_KEY));
}

export const requireServerApiKey: MiddlewareHandler = async (c, next) => {
  const apiKey = getRequestApiKey(c.req.raw);
  if (!apiKey || !isValidServerApiKey(apiKey)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
};
