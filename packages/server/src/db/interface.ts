import type { ModelMessage } from "ai";

import type { GenerateResponse } from "@/generate.js";

export interface DesignMetadata {
  id: string;
  ownerId: string | null;
  promptHistory: ModelMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface UpsertDesignParams {
  id: string;
  ownerId?: string | null;
  promptHistory: ModelMessage[];
  s3Key: string;
}

export interface GenerateRequestStatus {
  requestId: string;
  startedAt: number;
  completedAt: number | null;
  queuePosition: number | null;
  failedAt: number | null;
  savedAt: number | null;
  error: string | null;
  result: GenerateResponse | null;
}

export interface StoredGenerateRequestStatus extends GenerateRequestStatus {
  processing: boolean;
}

export interface Db {
  upsertDesignMetadata(params: UpsertDesignParams): Promise<void>;
  getDesignMetadata(id: string): Promise<DesignMetadata | null>;
  upsertGenerateRequestStatus(status: StoredGenerateRequestStatus): Promise<void>;
  getGenerateRequestStatus(requestId: string): Promise<StoredGenerateRequestStatus | null>;
  deleteGenerateRequestStatus(requestId: string): Promise<void>;
}
