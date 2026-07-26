// No upstream equivalent — this is the piece that replaces the browser tab's lifetime.
// A "session" here is exactly one live SceneGraph + FigmaAPI + conversation history,
// addressed by the design's UUID. Nothing is written to storage until an explicit save.

import { randomUUID } from "node:crypto";
import type { ModelMessage } from "ai";

import type { DocumentHandle } from "@/document.js";
import { createBlankDocument } from "@/document.js";
import { env } from "@/env";

export interface Session {
  id: string;
  doc: DocumentHandle;
  messages: ModelMessage[];
  createdAt: number;
  lastActiveAt: number;
  savedAt: number | null;
}

const sessions = new Map<string, Session>();

export function createSession(doc?: DocumentHandle, id?: string): Session {
  const session: Session = {
    id: id ?? randomUUID(),
    doc: doc ?? createBlankDocument(),
    messages: [],
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    savedAt: null,
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): Session | undefined {
  const session = sessions.get(id);
  if (session) session.lastActiveAt = Date.now();
  return session;
}

export function touchSession(id: string): void {
  const session = sessions.get(id);
  if (session) session.lastActiveAt = Date.now();
}

export function markSaved(id: string): void {
  const session = sessions.get(id);
  if (session) session.savedAt = Date.now();
}

export function deleteSession(id: string): void {
  sessions.delete(id);
}

/** Drop sessions that went idle past the TTL and were never explicitly saved. */
function sweepExpiredSessions(): void {
  const ttlMs = env.SESSION_TTL_MINUTES * 60_000;
  const now = Date.now();
  for (const [id, session] of sessions) {
    const idleMs = now - session.lastActiveAt;
    if (idleMs > ttlMs && session.savedAt === null) {
      sessions.delete(id);
    }
  }
}

const sweepInterval = setInterval(sweepExpiredSessions, 60_000);
sweepInterval.unref();

/**
 * IMPORTANT: sessions live in this process's memory only. If you run more than one
 * server instance (e.g. behind a load balancer), route requests for a given design UUID
 * to the same instance (sticky sessions), or move session state to a shared cache
 * (Redis) and rebuild the FigmaAPI on each request instead of holding it across requests.
 */
