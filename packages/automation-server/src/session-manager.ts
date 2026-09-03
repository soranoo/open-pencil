// Upstream headless version held a live `DocumentHandle` (in-memory SceneGraph) per
// session and re-serialized it on every read/write. There's no in-memory graph anymore —
// the browser session in automation-engine.ts holds the live document, and this module
// only tracks: (1) session metadata (messages/timestamps/savedAt) in the KV store, exactly
// as before, and (2) the last-known .fig bytes for the design in temp storage, written
// after each successful generate call. Public functions consumed by unchanged files
// (routes/put.ts -> markSaved, queue/generate-worker.ts -> getSession) keep their exact
// original signatures.

import type { ModelMessage } from "ai";

import { env } from "@/env.js";
import { getKvStore } from "@/kv/index.js";
import { getStorage } from "@/storage/index.js";
import { getUuid } from "@/utils/get-uuid.js";

export interface Session {
  id: string;
  messages: ModelMessage[];
  createdAt: number;
  lastActiveAt: number;
  savedAt: number | null;
}

const kv = getKvStore();
const storage = getStorage();

function sessionKey(id: string): string {
  return `session:${id}`;
}

export function tempDocKey(id: string): string {
  return `temp/${id}`;
}

function sessionTtlMs(): number {
  return env.SESSION_TTL_MINUTES * 60_000;
}

export async function createSession(id?: string): Promise<Session> {
  const sessionId = id ?? getUuid();
  const now = Date.now();
  const session: Session = {
    id: sessionId,
    messages: [],
    createdAt: now,
    lastActiveAt: now,
    savedAt: null
  };
  await kv.set(sessionKey(sessionId), JSON.stringify(session), sessionTtlMs());
  return session;
}

export async function getSession(id: string): Promise<Session | undefined> {
  const stored = await kv.get(sessionKey(id));
  if (!stored) return undefined;

  const data = JSON.parse(stored) as Session;
  data.lastActiveAt = Date.now();
  await kv.set(sessionKey(id), JSON.stringify(data), sessionTtlMs());
  return data;
}

/**
 * Appends one prompt/response turn to a session's history and bumps its TTL.
 * `summary` is the AI's final text reply for that turn — the closest
 * equivalent available now that generation runs as a black box inside the
 * real app rather than a locally-inspectable multi-step agent loop.
 */
export async function recordGenerateTurn(id: string, prompt: string, summary: string): Promise<void> {
  const session = (await getSession(id)) ?? (await createSession(id));
  const turn: ModelMessage[] = [
    { role: "user", content: prompt },
    { role: "assistant", content: summary }
  ];
  session.messages = [...session.messages, ...turn];
  session.lastActiveAt = Date.now();
  await kv.set(sessionKey(id), JSON.stringify(session), sessionTtlMs());
}

export async function touchSession(id: string): Promise<void> {
  const stored = await kv.get(sessionKey(id));
  if (!stored) return;

  const data = JSON.parse(stored) as Session;
  data.lastActiveAt = Date.now();
  await kv.set(sessionKey(id), JSON.stringify(data), sessionTtlMs());
}

export async function markSaved(id: string): Promise<void> {
  const stored = await kv.get(sessionKey(id));
  if (!stored) return;

  const data = JSON.parse(stored) as Session;
  data.savedAt = Date.now();
  await kv.set(sessionKey(id), JSON.stringify(data));
}

export async function deleteSession(id: string): Promise<void> {
  await storage.delete(tempDocKey(id)).catch(() => {});
  await kv.delete(sessionKey(id));
}

/** Stores the latest .fig bytes for an in-progress (not yet /save'd) design. */
export async function putSessionDocBytes(id: string, bytes: Uint8Array): Promise<void> {
  await storage.put(tempDocKey(id), bytes);
}

/** Reads the latest .fig bytes for an in-progress design, if any have been generated yet. */
export async function getSessionDocBytes(id: string): Promise<Uint8Array | undefined> {
  return storage.get(tempDocKey(id)).catch(() => undefined);
}
