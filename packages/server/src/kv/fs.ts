import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path, { join } from "node:path";

import { MemoryKvStore, type MemoryEntry } from "./memory";
import { env } from "@/env";

export class FsKvStore extends MemoryKvStore {
  private ready: Promise<void>;
  private kvPath = join(env.STORAGE_DIR, "kv", "kv.json");

  async saveStore(): Promise<void> {
    const json = JSON.stringify([...this.store]);
    await writeFile(this.kvPath, json, "utf8");
  }
  async readStore(): Promise<Map<string, MemoryEntry>> {
    if (!existsSync(this.kvPath)) {
      return new Map([]);
    }
    const data = await readFile(this.kvPath, "utf8");
    return new Map(JSON.parse(data));
  }

  constructor() {
    super();
    this.ready = (async () => {
      await mkdir(path.dirname(this.kvPath), { recursive: true });
      this.store = await this.readStore();
    })();
  }

  override async set(key: string, value: string, ttlMs?: number): Promise<void> {
    await this.ready;
    super.set(key, value, ttlMs);
    this.saveStore();
  }

  override async get(key: string): Promise<string | null> {
    const res = await super.get(key);

    return res;
  }

  override async delete(key: string): Promise<void> {
    await this.ready;
    await super.delete(key);
    this.saveStore();
  }
}
