import { FsStorage } from "./fs";
import type { Storage } from "./interface";
import { S3Storage } from "./s3";
import { env } from "@/env";

export type { Storage } from "./interface";

let storage: Storage;

if (env.S3_ENDPOINT) {
  if (!env.S3_REGION || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new Error(
      "Missing one or multiple S3 configation, please check 'S3_REGION', 'S3_ACCESS_KEY_ID' and 'S3_SECRET_ACCESS_KEY'.",
    );
  }

  storage = new S3Storage({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
} else {
  storage = new FsStorage();
}

export function getStorage(): Storage {
  return storage;
}
