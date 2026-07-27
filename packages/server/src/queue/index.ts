import { assertNever } from "assert-never";

import { AmqpMessageQueue } from "./amqp.js";
import { FsMessageQueue } from "./fs.js";
import type { MessageQueue } from "./interface";
import { MemoryMessageQueue } from "./memory.js";
import { env } from "@/env.js";

const queues = new Map<string, MessageQueue<unknown>>();

function createQueue<TPayload>(name: string): MessageQueue<TPayload> {
  switch (env.QUEUE_PROVIDER) {
    case "memory":
      return new MemoryMessageQueue<TPayload>();
    case "fs":
      return new FsMessageQueue<TPayload>(`${name}.json`);
    case "amqp": {
      if (!env.AMQP_URL) {
        throw new Error("AMQP_URL is required when QUEUE_PROVIDER is set to amqp");
      }
      return new AmqpMessageQueue<TPayload>({
        url: env.AMQP_URL,
        queueName: `${env.AMQP_QUEUE_NAME}.${name}`,
      });
    }
    default:
      assertNever(env.QUEUE_PROVIDER);
  }
}

export function getMessageQueue<TPayload>(name: string): MessageQueue<TPayload> {
  const existing = queues.get(name) as MessageQueue<TPayload> | undefined;
  if (existing) {
    return existing;
  }

  const queue = createQueue<TPayload>(name);
  queues.set(name, queue as MessageQueue<unknown>);
  return queue;
}
