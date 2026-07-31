import { getDb } from "@/db/index.js";
import { serializeDocument } from "@/document.js";
import { getSession, markSaved } from "@/session-manager.js";
import { getStorage } from "@/storage/index.js";

export class ActiveSessionNotFoundError extends Error {
  constructor(designId: string) {
    super(`No active session for ${designId}. Generate first, then save.`);
    this.name = "ActiveSessionNotFoundError";
  }
}

export interface SaveDesignResult {
  designId: string;
  savedBytes: number;
}

export async function saveDesignSession(designId: string): Promise<SaveDesignResult> {
  const session = await getSession(designId);
  if (!session) {
    throw new ActiveSessionNotFoundError(designId);
  }

  const bytes = await serializeDocument(session.doc.graph);
  await getStorage().put(designId, bytes);
  await getDb().upsertDesignMetadata({
    id: designId,
    promptHistory: session.messages,
    s3Key: `designs/${designId}.fig`,
  });
  await markSaved(designId);

  const fileToDelete = `temp/${designId}`;
  await getStorage()
    .delete(fileToDelete)
    .catch((error) => {
      console.error(`Failed to delete ${fileToDelete}, reason: ${error instanceof Error ? error.message : error}`);
    });

  return { designId, savedBytes: bytes.byteLength };
}

export async function isDesignSaved(designId: string): Promise<boolean> {
  const session = await getSession(designId);
  if (session) {
    return session.savedAt !== null;
  }

  const metadata = await getDb().getDesignMetadata(designId);
  return metadata !== null;
}
