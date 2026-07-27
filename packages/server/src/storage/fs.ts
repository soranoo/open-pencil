import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Storage } from "./interface";
import { env } from "@/env";

function objectPath(designId: string): string {
  return join(env.STORAGE_DIR, "designs", `${designId}.fig`);
}

export class FsStorage implements Storage {
  private ready: Promise<void>;

  constructor() {
    this.ready = mkdir(join(env.STORAGE_DIR, "designs"), { recursive: true }) as Promise<void>;
  }

  async put(designId: string, bytes: Uint8Array): Promise<void> {
    await this.ready;
    const path = objectPath(designId);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async get(designId: string): Promise<Uint8Array> {
    await this.ready;
    return new Uint8Array(await readFile(objectPath(designId)));
  }

  async delete(designId: string): Promise<void> {
    await this.ready;
    await unlink(objectPath(designId)).catch(() => {});
  }
}
