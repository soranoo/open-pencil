import { existsSync } from "node:fs";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import path, { join } from "node:path";

import type { DesignMetadata, UpsertDesignParams } from "./interface";
import { MemoryDb, type MemoryRow } from "./memory";
import { env } from "@/env";

export class FsDb extends MemoryDb {
  private ready: Promise<void>;
  private dbPath = join(env.STORAGE_DIR, "db", "db.json");

  async saveStore(): Promise<void> {
    const json = JSON.stringify([...this.store]);
    await writeFile(this.dbPath, json, "utf8");
  }
  async readStore(): Promise<Map<string, MemoryRow>> {
    if (!existsSync(this.dbPath)) {
      return new Map([]);
    }
    const data = await readFile(this.dbPath, "utf8");
    return new Map(JSON.parse(data));
  }

  constructor() {
    super();
    this.ready = (async () => {
      await mkdir(path.dirname(this.dbPath), { recursive: true });
      this.store = await this.readStore();
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
}
