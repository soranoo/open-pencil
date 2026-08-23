import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { QueueConsumeOptions, QueueJob } from "./interface";
import { MemoryMessageQueue } from "./memory.js";
import { env } from "@/env.js";

export class FsMessageQueue<TPayload> extends MemoryMessageQueue<TPayload> {
  private ready: Promise<void>;
  private queuePath: string;

  constructor(fileName = "queue.json") {
    super();
    this.queuePath = join(env.STORAGE_DIR, "queue", fileName);
    this.ready = this.init();
  }

  override async enqueue(payload: TPayload): Promise<QueueJob<TPayload>> {
    await this.ready;
    return super.enqueue(payload);
  }

  override async consume(options: QueueConsumeOptions<TPayload>): Promise<void> {
    await this.ready;
    await super.consume(options);
  }

  override async size(): Promise<number> {
    await this.ready;
    return super.size();
  }

  protected override async onQueueChanged(): Promise<void> {
    await this.ready;
    await this.saveStore();
  }

  private async init(): Promise<void> {
    await mkdir(join(env.STORAGE_DIR, "queue"), { recursive: true });
    this.jobs = await this.readStore();
  }

  private async readStore(): Promise<Array<QueueJob<TPayload>>> {
    if (!existsSync(this.queuePath)) {
      return [];
    }
    const data = await readFile(this.queuePath, "utf8");
    return JSON.parse(data) as Array<QueueJob<TPayload>>;
  }

  private async saveStore(): Promise<void> {
    await writeFile(this.queuePath, JSON.stringify(this.jobs), "utf8");
  }
}
