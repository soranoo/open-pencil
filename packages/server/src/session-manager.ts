import type { ModelMessage } from "ai";

import type { DocumentHandle } from "@/document.js";
import { createBlankDocument, loadDocument, serializeDocument } from "@/document.js";
import { env } from "@/env";
import { getKvStore } from "@/kv/index.js";
import { getStorage } from "@/storage/index.js";
import { getUuid } from "@/utils/get-uuid";

export interface Session {
  id: string;
  doc: DocumentHandle;
  messages: ModelMessage[];
  createdAt: number;
  lastActiveAt: number;
  savedAt: number | null;
}

interface StoredSession {
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

function tempDocKey(id: string): string {
  return `temp/${id}`;
}

function sessionTtlMs(): number {
  return env.SESSION_TTL_MINUTES * 60_000;
}

export async function createSession(doc?: DocumentHandle, id?: string): Promise<Session> {
  const sessionId = id ?? getUuid();
  const handle = doc ?? createBlankDocument();
  const now = Date.now();
  const session: Session = {
    id: sessionId,
    doc: handle,
    messages: [],
    createdAt: now,
    lastActiveAt: now,
    savedAt: null,
  };

  const bytes = await serializeDocument(handle.graph);
  await storage.put(tempDocKey(sessionId), bytes);

  const stored: StoredSession = {
    id: sessionId,
    messages: session.messages,
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt,
    savedAt: session.savedAt,
  };
  await kv.set(sessionKey(sessionId), JSON.stringify(stored), sessionTtlMs());

  return session;
}

export async function getSession(id: string): Promise<Session | undefined> {
  const stored = await kv.get(sessionKey(id));
  if (!stored) return undefined;

  const data = JSON.parse(stored) as StoredSession;

  let handle: DocumentHandle;
  try {
    const bytes = await storage.get(tempDocKey(id));
    handle = await loadDocument(bytes);
  } catch {
    return undefined;
  }

  data.lastActiveAt = Date.now();
  await kv.set(sessionKey(id), JSON.stringify(data), sessionTtlMs());

  return {
    id: data.id,
    doc: handle,
    messages: data.messages,
    createdAt: data.createdAt,
    lastActiveAt: data.lastActiveAt,
    savedAt: data.savedAt,
  };
}

export async function persistSession(session: Session): Promise<void> {
  const bytes = await serializeDocument(session.doc.graph);
  await storage.put(tempDocKey(session.id), bytes);

  const stored: StoredSession = {
    id: session.id,
    messages: session.messages,
    createdAt: session.createdAt,
    lastActiveAt: Date.now(),
    savedAt: session.savedAt,
  };
  await kv.set(sessionKey(session.id), JSON.stringify(stored), sessionTtlMs());
}

export async function touchSession(id: string): Promise<void> {
  const stored = await kv.get(sessionKey(id));
  if (!stored) return;

  const data = JSON.parse(stored) as StoredSession;
  data.lastActiveAt = Date.now();
  await kv.set(sessionKey(id), JSON.stringify(data), sessionTtlMs());
}

export async function markSaved(id: string): Promise<void> {
  const stored = await kv.get(sessionKey(id));
  if (!stored) return;

  const data = JSON.parse(stored) as StoredSession;
  data.savedAt = Date.now();
  await kv.set(sessionKey(id), JSON.stringify(data));
}

export async function deleteSession(id: string): Promise<void> {
  await storage.delete(tempDocKey(id)).catch(() => {});
  await kv.delete(sessionKey(id));
}
