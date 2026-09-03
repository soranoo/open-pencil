import type { MessageQueue, QueueConsumeOptions, QueueDelivery, QueueJob } from "./interface";
import { getUuid } from "@/utils/get-uuid";

export class MemoryMessageQueue<TPayload> implements MessageQueue<TPayload> {
  protected jobs: QueueJob<TPayload>[] = [];
  private waiters: Array<() => void> = [];
  private started = false;

  async enqueue(payload: TPayload): Promise<QueueJob<TPayload>> {
    const job: QueueJob<TPayload> = {
      id: getUuid(),
      payload,
      enqueuedAt: Date.now(),
    };
    this.jobs.push(job);
    this.wakeOneWorker();
    await this.onQueueChanged();
    return job;
  }

  async consume(options: QueueConsumeOptions<TPayload>): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;

    for (let index = 0; index < options.concurrency; index += 1) {
      void this.startWorker(options);
    }
  }

  async size(): Promise<number> {
    return this.jobs.length;
  }

  protected async onQueueChanged(): Promise<void> {
    return;
  }

  private async startWorker(options: QueueConsumeOptions<TPayload>): Promise<void> {
    for (;;) {
      const job = await this.nextJob();
      let settled = false;
      const delivery: QueueDelivery<TPayload> = {
        ...job,
        ack: async () => {
          if (settled) {
            return;
          }
          settled = true;
          await this.onQueueChanged();
        },
        reject: async (requeue = true) => {
          if (settled) {
            return;
          }
          settled = true;
          if (requeue) {
            this.jobs.push(job);
            this.wakeOneWorker();
          }
          await this.onQueueChanged();
        },
      };

      try {
        await options.handler(delivery);
      } catch {
        await delivery.reject();
      }
    }
  }

  private async nextJob(): Promise<QueueJob<TPayload>> {
    while (this.jobs.length === 0) {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }

    const job = this.jobs.shift();
    if (!job) {
      throw new Error("Queue worker failed to dequeue job");
    }
    await this.onQueueChanged();
    return job;
  }

  private wakeOneWorker(): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter();
    }
  }
}
