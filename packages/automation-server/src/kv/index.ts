import { assertNever } from "assert-never";

import { FsKvStore } from "./fs";
import type { KvStore } from "./interface";
import { MemoryKvStore } from "./memory";
import { RedisKvStore } from "./redis";
import { env } from "@/env";

export type { KvStore } from "./interface";

let kv: KvStore;

switch (env.KV_PROVIDER) {
  case "redis": {
    if (!env.REDIS_URL) {
      throw new Error("REDIS_URL is required when KV_PROVIDER is set to redis");
    }
    kv = new RedisKvStore(env.REDIS_URL);
    break;
  }
  case "fs": {
    kv = new FsKvStore();
    break;
  }
  case "memory": {
    kv = new MemoryKvStore();
    break;
  }
  default:
    assertNever(env.KV_PROVIDER);
}

export function getKvStore(): KvStore {
  return kv;
}
