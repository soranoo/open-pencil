import { existsSync } from "node:fs";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import path, { join } from "node:path";

import type {
  DesignMetadata,
  StoredGenerateRequestStatus,
  UpsertDesignParams,
} from "./interface";
import { MemoryDb, type MemoryRow } from "./memory";
import { env } from "@/env";

interface PersistedFsDb {
  designs: Array<[string, MemoryRow]>;
  generateRequests: Array<[string, StoredGenerateRequestStatus]>;
}

export class FsDb extends MemoryDb {
  private ready: Promise<void>;
  private dbPath = join(env.STORAGE_DIR, "db", "db.json");

  async saveStore(): Promise<void> {
    const json = JSON.stringify({
      designs: [...this.store],
      generateRequests: [...this.generateRequestStore],
    } satisfies PersistedFsDb);
    await writeFile(this.dbPath, json, "utf8");
  }
  async readStore(): Promise<{
    designs: Map<string, MemoryRow>;
    generateRequests: Map<string, StoredGenerateRequestStatus>;
  }> {
    if (!existsSync(this.dbPath)) {
      return { designs: new Map(), generateRequests: new Map() };
    }
    const data = await readFile(this.dbPath, "utf8");
    const parsed = JSON.parse(data) as PersistedFsDb | Array<[string, MemoryRow]>;
    if (Array.isArray(parsed)) {
      return { designs: new Map(parsed), generateRequests: new Map() };
    }
    return {
      designs: new Map(parsed.designs),
      generateRequests: new Map(parsed.generateRequests ?? []),
    };
  }

  constructor() {
    super();
    this.ready = (async () => {
      await mkdir(path.dirname(this.dbPath), { recursive: true });
      const persisted = await this.readStore();
      this.store = persisted.designs;
      this.generateRequestStore = persisted.generateRequests;
    })();
  }

  override async upsertDesignMetadata(params: UpsertDesignParams): Promise<void> {
    await this.ready;
    super.upsertDesignMetadata(params);
    await this.saveStore();
  }
  override async getDesignMetadata(id: string): Promise<DesignMetadata | null> {
    await this.ready;
    return super.getDesignMetadata(id);
  }

  override async upsertGenerateRequestStatus(status: StoredGenerateRequestStatus): Promise<void> {
    await this.ready;
    await super.upsertGenerateRequestStatus(status);
    await this.saveStore();
  }

  override async getGenerateRequestStatus(requestId: string): Promise<StoredGenerateRequestStatus | null> {
    await this.ready;
    return super.getGenerateRequestStatus(requestId);
  }

  override async deleteGenerateRequestStatus(requestId: string): Promise<void> {
    await this.ready;
    await super.deleteGenerateRequestStatus(requestId);
    await this.saveStore();
  }
}
