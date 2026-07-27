import type { ModelMessage } from "ai";

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

export interface Db {
  upsertDesignMetadata(params: UpsertDesignParams): Promise<void>;
  getDesignMetadata(id: string): Promise<DesignMetadata | null>;
}
