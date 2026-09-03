// TODO: rename this file. "generate-worker.ts" is a bad naming lol

import { getMessageQueue } from "./index.js";
import type { QueueDelivery } from "./interface.js";
import { getDb, type GenerateRequestStatus, type StoredGenerateRequestStatus } from "@/db/index.js";
import { saveDesignSession } from "@/design-save.js";
import { env } from "@/env.js";
import { processGenerateRequest, type GenerateRequest, type GenerateResponse } from "@/generate.js";
import { getSession } from "@/session-manager.js";
import { getUuid } from "@/utils/get-uuid.js";

export const GENERATE_QUEUE_NAME = "generate";

export interface EnqueueGenerateResponse {
  requestId: string;
  queuePosition: number;
}

interface QueuedGenerateRequest extends GenerateRequest {
  requestId: string;
}

interface InternalGenerateRequestStatus extends StoredGenerateRequestStatus {
  processing: boolean;
}

const queuedRequestIds: string[] = [];

const generateQueue = getMessageQueue<QueuedGenerateRequest>(GENERATE_QUEUE_NAME);
const db = getDb();

let workerStarted = false;

export async function enqueueGenerateRequest(
  payload: GenerateRequest,
): Promise<EnqueueGenerateResponse> {
  await ensureGenerateWorker();
  const requestId = getUuid();
  const startedAt = Date.now();

  const status: InternalGenerateRequestStatus = {
    requestId,
    startedAt,
    completedAt: null,
    queuePosition: null,
    failedAt: null,
    savedAt: null,
    error: null,
    result: null,
    processing: false,
  };

  queuedRequestIds.push(requestId);
  await db.upsertGenerateRequestStatus(status);
  await updateQueuedPositions();

  await generateQueue.enqueue({ ...payload, requestId }).catch((error) => {
    db.deleteGenerateRequestStatus(requestId);
    removeFromQueued(requestId);
    throw error;
  });

  const queuePosition = (await db.getGenerateRequestStatus(requestId))?.queuePosition ?? 1;
  return { requestId, queuePosition };
}

export async function getGenerateRequestStatus(
  requestId: string,
): Promise<GenerateRequestStatus | null> {
  await ensureGenerateWorker();
  const status = await db.getGenerateRequestStatus(requestId);
  if (!status) {
    return null;
  }

  const savedAt = await getSavedAt(status);
  return {
    requestId: status.requestId,
    startedAt: status.startedAt,
    completedAt: status.completedAt,
    queuePosition: status.queuePosition,
    failedAt: status.failedAt,
    savedAt,
    error: status.error,
    result: status.result,
  };
}

export async function getGenerateQueueSize(): Promise<number> {
  await ensureGenerateWorker();
  return generateQueue.size();
}

async function ensureGenerateWorker(): Promise<void> {
  if (workerStarted) {
    return;
  }
  workerStarted = true;

  try {
    await generateQueue.consume({
      concurrency: env.AI_MAX_CONCURRENCY_PER_WORKER,
      handler: processGenerateDelivery,
    });
  } catch (error) {
    workerStarted = false;
    throw error;
  }
}

async function processGenerateDelivery(
  delivery: QueueDelivery<QueuedGenerateRequest>,
): Promise<void> {
  await markProcessing(delivery.payload.requestId);

  try {
    const response = await processGenerateRequest(delivery.payload, {
      requestId: delivery.payload.requestId,
    });
    let savedAt: number | null = null;
    let completionError: string | null = null;

    if (delivery.payload.autosave) {
      try {
        await saveDesignSession(response.designId);
        savedAt = Date.now();
      } catch (error) {
        console.error("[generate-worker] autosave failed", {
          requestId: delivery.payload.requestId,
          designId: response.designId,
          error: error instanceof Error ? error.message : String(error),
        });
        completionError = error instanceof Error ? `Autosave failed: ${error.message}` : "Autosave failed";
      }
    }

    await delivery.ack();
    await markCompleted(delivery.payload.requestId, { ...response }, savedAt, completionError);
  } catch (error) {
    await delivery.reject(false);
    const message = error instanceof Error ? error.message : "Generation failed";
    console.error("[generate-worker] generation failed", {
      requestId: delivery.payload.requestId,
      error: message,
    });
    await markFailed(delivery.payload.requestId, message);
  }
}

async function markProcessing(requestId: string): Promise<void> {
  const status = await db.getGenerateRequestStatus(requestId);
  if (!status) {
    return;
  }
  status.processing = true;
  status.queuePosition = 0;
  await db.upsertGenerateRequestStatus(status);
  await removeFromQueued(requestId);
}

async function markCompleted(
  requestId: string,
  result: GenerateResponse,
  savedAt: number | null,
  error: string | null,
): Promise<void> {
  const status = await db.getGenerateRequestStatus(requestId);
  if (!status) {
    return;
  }
  status.processing = false;
  status.completedAt = Date.now();
  status.queuePosition = null;
  status.failedAt = null;
  status.savedAt = savedAt;
  status.error = error;
  status.result = result;
  await db.upsertGenerateRequestStatus(status);
}

async function markFailed(requestId: string, error: string): Promise<void> {
  const status = await db.getGenerateRequestStatus(requestId);
  if (!status) {
    return;
  }
  status.processing = false;
  status.completedAt = Date.now();
  status.queuePosition = null;
  status.failedAt = status.completedAt;
  status.savedAt = null;
  status.error = error;
  status.result = null;
  await db.upsertGenerateRequestStatus(status);
}

async function getSavedAt(status: StoredGenerateRequestStatus): Promise<number | null> {
  if (status.savedAt !== null) {
    return status.savedAt;
  }
  const designId = status.result?.designId;
  if (!designId) {
    return null;
  }

  const session = await getSession(designId);
  status.savedAt = session?.savedAt ?? null;
  await db.upsertGenerateRequestStatus(status);
  return status.savedAt;
}

async function removeFromQueued(requestId: string): Promise<void> {
  const index = queuedRequestIds.indexOf(requestId);
  if (index === -1) {
    return;
  }
  queuedRequestIds.splice(index, 1);
  await updateQueuedPositions();
}

async function updateQueuedPositions(): Promise<void> {
  for (const [index, requestId] of queuedRequestIds.entries()) {
    const status = await db.getGenerateRequestStatus(requestId);
    if (!status || status.processing || status.completedAt !== null) {
      continue;
    }
    status.queuePosition = index + 1;
    await db.upsertGenerateRequestStatus(status);
  }
}
