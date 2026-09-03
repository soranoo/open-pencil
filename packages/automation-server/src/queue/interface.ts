export interface QueueJob<TPayload> {
  id: string;
  payload: TPayload;
  enqueuedAt: number;
}

export interface QueueDelivery<TPayload> extends QueueJob<TPayload> {
  ack(): Promise<void>;
  reject(requeue?: boolean): Promise<void>;
}

export interface QueueConsumeOptions<TPayload> {
  concurrency: number;
  handler: (delivery: QueueDelivery<TPayload>) => Promise<void>;
}

export interface MessageQueue<TPayload> {
  enqueue(payload: TPayload): Promise<QueueJob<TPayload>>;
  consume(options: QueueConsumeOptions<TPayload>): Promise<void>;
  size(): Promise<number>;
}
