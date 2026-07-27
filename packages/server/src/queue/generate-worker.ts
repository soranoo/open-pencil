// TODO: rename this file. "generate-worker.ts" is a bad naming lol

import { getMessageQueue } from "./index.js";
import type { QueueDelivery } from "./interface.js";
import { env } from "@/env.js";
import { processGenerateRequest, type GenerateRequest, type GenerateResponse } from "@/generate.js";
import { getUuid } from "@/utils/get-uuid.js";

export const GENERATE_QUEUE_NAME = "generate";

export interface EnqueueGenerateResponse {
  requestId: string;
  queuePosition: number;
}

interface QueuedGenerateRequest extends GenerateRequest {
  requestId: string;
}

export interface GenerateRequestStatus {
  requestId: string;
  completed: boolean;
  queuePosition: number | null;
  failed: boolean;
  error: string | null;
  result: GenerateResponse | null;
}

interface InternalGenerateRequestStatus extends GenerateRequestStatus {
  processing: boolean;
}

const requestStatuses = new Map<string, InternalGenerateRequestStatus>();
const queuedRequestIds: string[] = [];

const generateQueue = getMessageQueue<QueuedGenerateRequest>(GENERATE_QUEUE_NAME);

let workerStarted = false;

export async function enqueueGenerateRequest(
  payload: GenerateRequest,
): Promise<EnqueueGenerateResponse> {
  await ensureGenerateWorker();
  const requestId = getUuid();

  const status: InternalGenerateRequestStatus = {
    requestId,
    completed: false,
    queuePosition: null,
    failed: false,
    error: null,
    result: null,
    processing: false,
  };

  requestStatuses.set(requestId, status);
  queuedRequestIds.push(requestId);
  updateQueuedPositions();

  await generateQueue.enqueue({ ...payload, requestId }).catch((error) => {
    requestStatuses.delete(requestId);
    removeFromQueued(requestId);
    throw error;
  });

  const queuePosition = requestStatuses.get(requestId)?.queuePosition ?? 1;
  return { requestId, queuePosition };
}

export async function getGenerateRequestStatus(
  requestId: string,
): Promise<GenerateRequestStatus | null> {
  await ensureGenerateWorker();
  const status = requestStatuses.get(requestId);
  if (!status) {
    return null;
  }

  return {
    requestId: status.requestId,
    completed: status.completed,
    queuePosition: status.queuePosition,
    failed: status.failed,
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
  markProcessing(delivery.payload.requestId);

  try {
    const response = await processGenerateRequest(delivery.payload);
    await delivery.ack();
    markCompleted(delivery.payload.requestId, response);
  } catch (error) {
    await delivery.reject(false);
    const message = error instanceof Error ? error.message : "Generation failed";
    markFailed(delivery.payload.requestId, message);
  }
}

function markProcessing(requestId: string): void {
  const status = requestStatuses.get(requestId);
  if (!status) {
    return;
  }
  status.processing = true;
  status.queuePosition = 0;
  removeFromQueued(requestId);
}

function markCompleted(requestId: string, result: GenerateResponse): void {
  const status = requestStatuses.get(requestId);
  if (!status) {
    return;
  }
  status.processing = false;
  status.completed = true;
  status.queuePosition = null;
  status.failed = false;
  status.error = null;
  status.result = result;
}

function markFailed(requestId: string, error: string): void {
  const status = requestStatuses.get(requestId);
  if (!status) {
    return;
  }
  status.processing = false;
  status.completed = true;
  status.queuePosition = null;
  status.failed = true;
  status.error = error;
}

function removeFromQueued(requestId: string): void {
  const index = queuedRequestIds.indexOf(requestId);
  if (index === -1) {
    return;
  }
  queuedRequestIds.splice(index, 1);
  updateQueuedPositions();
}

function updateQueuedPositions(): void {
  for (const [index, requestId] of queuedRequestIds.entries()) {
    const status = requestStatuses.get(requestId);
    if (!status || status.processing || status.completed) {
      continue;
    }
    status.queuePosition = index + 1;
  }
}
