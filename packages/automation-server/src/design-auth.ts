import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { EncryptJWT, jwtDecrypt } from "jose";

import { env } from "@/env.js";
import { getKvStore } from "@/kv/index.js";

export type DesignPermission = "read" | "write";

export interface SignedDesignAccess {
  designId: string;
  accessKey: string;
  expiresAt: number;
  permission: DesignPermission;
  signature: string;
}

interface DesignAccessCookiePayload {
  designId: string;
  permission: DesignPermission;
  accessKey: string;
  exp: number;
}

export interface DesignAccessSession {
  designId: string;
  permission: DesignPermission;
  accessKey: string;
  expiresAt: number;
  source: "cookie" | "signed-url";
}

const kv = getKvStore();
const ACCESS_COOKIE_PREFIX = "op_design_auth_";

let cookieKey: Uint8Array | null = null;

function getCookieKey(): Uint8Array {
  if (cookieKey) return cookieKey;
  const encoder = new TextEncoder();
  const material = encoder.encode(env.DESIGN_SIGNING_SECRET);
  const key = new Uint8Array(32);
  key.set(material.slice(0, 32));
  cookieKey = key;
  return key;
}

function normalizePermission(permission?: string | null): DesignPermission {
  return permission === "write" ? "write" : "read";
}

function hmacSha256Base64Url(input: string): string {
  return createHmac("sha256", env.DESIGN_SIGNING_SECRET).update(input).digest("base64url");
}

type SignedDesignUrlFields = Omit<SignedDesignAccess, "signature">;

function createSignedDesignTargetUrl(fields: SignedDesignUrlFields): URL {
  const target = new URL(env.FRONTEND_URL);
  target.searchParams.delete("design");
  target.searchParams.delete("key");
  target.searchParams.delete("expiry");
  target.searchParams.delete("permission");
  target.searchParams.delete("sign");
  target.searchParams.set("design", fields.designId);
  target.searchParams.set("key", fields.accessKey);
  target.searchParams.set("expiry", String(fields.expiresAt));
  target.searchParams.set("permission", fields.permission);
  return target;
}

export function getSignedDesignUrl(access: SignedDesignAccess): string {
  const target = createSignedDesignTargetUrl(access);
  target.searchParams.set("sign", access.signature);
  return target.toString();
}

function createCookieName(designId: string): string {
  return `${ACCESS_COOKIE_PREFIX}${designId}`;
}

function usedAccessKeyKey(designId: string, accessKey: string): string {
  return `design-access:${designId}:${accessKey}`;
}

function compareSignatures(a: string, b: string): boolean {
  const aBytes = Buffer.from(a);
  const bBytes = Buffer.from(b);
  if (aBytes.length !== bBytes.length) return false;
  return timingSafeEqual(aBytes, bBytes);
}

async function encryptCookieValue(payload: DesignAccessCookiePayload): Promise<string> {
  return await new EncryptJWT({ ...payload })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .encrypt(getCookieKey());
}

async function decryptCookieValue(cookieValue: string): Promise<DesignAccessCookiePayload | null> {
  try {
    const { payload } = await jwtDecrypt(cookieValue, getCookieKey());
    const data = payload as Partial<DesignAccessCookiePayload>;
    if (
      typeof data.designId !== "string" ||
      typeof data.accessKey !== "string" ||
      typeof data.exp !== "number"
    ) {
      return null;
    }
    return {
      designId: data.designId,
      accessKey: data.accessKey,
      exp: data.exp,
      permission: normalizePermission(data.permission),
    };
  } catch {
    return null;
  }
}

function cookieTtlMs(): number {
  return env.DESIGN_COOKIE_TTL_MINUTES * 60_000;
}

function firstAccessTtlMs(): number {
  return env.DESIGN_FIRST_ACCESS_TTL_MINUTES * 60_000;
}

function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === "production";
}

async function setDesignAccessCookie(c: Context, session: DesignAccessSession): Promise<void> {
  const secure = isProductionEnvironment();
  setCookie(c, createCookieName(session.designId), await encryptCookieValue({
    designId: session.designId,
    permission: session.permission,
    accessKey: session.accessKey,
    exp: session.expiresAt,
  }), {
    httpOnly: true,
    secure,
    sameSite: secure ? "None" : "Lax",
    maxAge: Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)),
    path: "/",
  });
}

async function getDesignAccessCookie(c: Context, designId: string): Promise<DesignAccessCookiePayload | null> {
  const cookieValue = getCookie(c, createCookieName(designId));
  if (!cookieValue) return null;
  return await decryptCookieValue(cookieValue);
}

function hasRequiredPermission(
  grantedPermission: DesignPermission,
  requiredPermission: DesignPermission,
): boolean {
  if (grantedPermission === "write") return true;
  return requiredPermission === "read";
}

export function createSignedDesignUrl(designId: string, permission: DesignPermission): SignedDesignAccess {
  const accessKey = randomBytes(24).toString("base64url");
  const expiresAt = Date.now() + firstAccessTtlMs();
  const unsignedAccess = { designId, accessKey, expiresAt, permission };
  const signature = hmacSha256Base64Url(createSignedDesignTargetUrl(unsignedAccess).toString());

  return {
    designId,
    accessKey,
    expiresAt,
    permission,
    signature,
  };
}

export function validateSignedDesignAccess(input: {
  designId: string;
  design?: string | null;
  key?: string | null;
  expiry?: string | null;
  permission?: string | null;
  sign?: string | null;
}): SignedDesignAccess | null {
  const accessKey = input.key?.trim();
  const signature = input.sign?.trim();
  const expiresAt = Number(input.expiry);
  const permission = normalizePermission(input.permission);

  if (!accessKey || !signature || !Number.isFinite(expiresAt) || input.design !== input.designId) {
    return null;
  }

  const expectedSignature = hmacSha256Base64Url(
    createSignedDesignTargetUrl({
      designId: input.designId,
      accessKey,
      expiresAt,
      permission,
    }).toString(),
  );
  if (!compareSignatures(signature, expectedSignature)) {
    return null;
  }

  return {
    designId: input.designId,
    accessKey,
    expiresAt,
    permission,
    signature,
  };
}

export async function authenticateDesignAccess(
  c: Context,
  designId: string
): Promise<DesignAccessSession | null> {
  const cookie = await getDesignAccessCookie(c, designId);
  if (cookie && cookie.designId === designId && cookie.exp > Date.now()) {
    const session: DesignAccessSession = {
      designId,
      permission: cookie.permission,
      accessKey: cookie.accessKey,
      expiresAt: Date.now() + cookieTtlMs(),
      source: "cookie",
    };
    await setDesignAccessCookie(c, session);
    return session;
  }

  const signedAccess = validateSignedDesignAccess({
    designId,
    design: c.req.query("design"),
    key: c.req.query("key"),
    expiry: c.req.query("expiry"),
    permission: c.req.query("permission"),
    sign: c.req.query("sign"),
  });
  if (!signedAccess) {
    return null;
  }
  if (signedAccess.expiresAt <= Date.now()) {
    return null;
  }

  const accessKeyKey = usedAccessKeyKey(designId, signedAccess.accessKey);
  if (await kv.has(accessKeyKey)) {
    return null;
  }

  await kv.set(
    accessKeyKey,
    JSON.stringify({ usedAt: Date.now(), permission: signedAccess.permission }),
    Math.max(1, signedAccess.expiresAt - Date.now()),
  );

  const session: DesignAccessSession = {
    designId,
    permission: signedAccess.permission,
    accessKey: signedAccess.accessKey,
    expiresAt: Date.now() + cookieTtlMs(),
    source: "signed-url",
  };
  await setDesignAccessCookie(c, session);
  return session;
}

export async function requireDesignAccess(
  c: Context,
  designId: string,
  permission: DesignPermission,
): Promise<DesignAccessSession | Response | null> {
  const session = await authenticateDesignAccess(c, designId);
  if (!session) {
    return c.json({ error: "Unauthorized or expired design access" }, 401);
  }
  if (!hasRequiredPermission(session.permission, permission)) {
    return c.json({ error: "Design access does not allow this action" }, 403);
  }
  return session;
}

export function getDesignCookieRefreshIntervalMs(): number {
  return env.DESIGN_COOKIE_REFRESH_INTERVAL_MINUTES * 60_000;
}
