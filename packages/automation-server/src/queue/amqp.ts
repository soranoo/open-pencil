import { connect, type ChannelWrapper } from "amqp-connection-manager";
import type { ConsumeMessage } from "amqplib";

import type { MessageQueue, QueueConsumeOptions, QueueJob } from "./interface";
import { getUuid } from "@/utils/get-uuid";

interface AmqpQueueConfig {
  url: string;
  queueName: string;
}

interface AmqpEnvelope<TPayload> {
  id: string;
  payload: TPayload;
  enqueuedAt: number;
}

export class AmqpMessageQueue<TPayload> implements MessageQueue<TPayload> {
  private readonly queueName: string;
  private readonly channel: ChannelWrapper;
  private started = false;

  constructor(config: AmqpQueueConfig) {
    this.queueName = config.queueName;
    const connection = connect([config.url]);
    this.channel = connection.createChannel({
      setup: async (channel) => {
        await channel.assertQueue(this.queueName, { durable: true });
      },
    });
  }

  async enqueue(payload: TPayload): Promise<QueueJob<TPayload>> {
    const envelope: AmqpEnvelope<TPayload> = {
      id: getUuid(),
      payload,
      enqueuedAt: Date.now(),
    };
    await this.channel.sendToQueue(this.queueName, Buffer.from(JSON.stringify(envelope)), {
      persistent: true,
    });
    return {
      id: envelope.id,
      payload: envelope.payload,
      enqueuedAt: envelope.enqueuedAt,
    };
  }

  async consume(options: QueueConsumeOptions<TPayload>): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;

    await this.channel.consume(
      this.queueName,
      async (msg) => {
        if (!msg) {
          return;
        }
        await this.handleMessage(msg, options);
      },
      { noAck: false, prefetch: options.concurrency },
    );
  }

  async size(): Promise<number> {
    const info = await this.channel.checkQueue(this.queueName);
    return info.messageCount;
  }

  private async handleMessage(
    msg: ConsumeMessage,
    options: QueueConsumeOptions<TPayload>,
  ): Promise<void> {
    const envelope = this.parseEnvelope(msg);
    if (!envelope) {
      this.channel.nack(msg, false, false);
      return;
    }

    let settled = false;
    const delivery = {
      id: envelope.id,
      payload: envelope.payload,
      enqueuedAt: envelope.enqueuedAt,
      ack: async () => {
        if (settled) {
          return;
        }
        settled = true;
        this.channel.ack(msg);
      },
      reject: async (requeue = true) => {
        if (settled) {
          return;
        }
        settled = true;
        this.channel.nack(msg, false, requeue);
      },
    };

    try {
      await options.handler(delivery);
    } catch {
      await delivery.reject(true);
    }
  }

  private parseEnvelope(message: ConsumeMessage): AmqpEnvelope<TPayload> | null {
    try {
      const parsed = JSON.parse(message.content.toString("utf8")) as Partial<
        AmqpEnvelope<TPayload>
      >;
      if (
        typeof parsed.id !== "string" ||
        typeof parsed.enqueuedAt !== "number" ||
        !Object.hasOwn(parsed, "payload")
      ) {
        return null;
      }
      return parsed as AmqpEnvelope<TPayload>;
    } catch {
      return null;
    }
  }
}
