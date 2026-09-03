import type { ModelMessage } from "ai";

import type {
  Db,
  DesignMetadata,
  StoredGenerateRequestStatus,
  UpsertDesignParams,
} from "./interface";

export interface MemoryRow {
  ownerId: string | null;
  promptHistory: ModelMessage[];
  s3Key: string;
  createdAt: string;
  updatedAt: string;
}

export class MemoryDb implements Db {
  protected store = new Map<string, MemoryRow>();
  protected generateRequestStore = new Map<string, StoredGenerateRequestStatus>();

  async upsertDesignMetadata(params: UpsertDesignParams): Promise<void> {
    const existing = this.store.get(params.id);
    const now = new Date().toISOString();
    this.store.set(params.id, {
      ownerId: params.ownerId ?? null,
      promptHistory: params.promptHistory,
      s3Key: params.s3Key,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async getDesignMetadata(id: string): Promise<DesignMetadata | null> {
    const row = this.store.get(id);
    if (!row) return null;
    return { id, ...row };
  }

  async upsertGenerateRequestStatus(status: StoredGenerateRequestStatus): Promise<void> {
    this.generateRequestStore.set(status.requestId, structuredClone(status));
  }

  async getGenerateRequestStatus(requestId: string): Promise<StoredGenerateRequestStatus | null> {
    return structuredClone(this.generateRequestStore.get(requestId) ?? null);
  }

  async deleteGenerateRequestStatus(requestId: string): Promise<void> {
    this.generateRequestStore.delete(requestId);
  }
}
