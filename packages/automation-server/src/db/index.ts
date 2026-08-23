import assertNever from "assert-never";

import { FsDb } from "./fs";
import type { Db } from "./interface";
import { MemoryDb } from "./memory";
import { PostgresDb } from "./postgres";
import { env } from "@/env";

export type {
  Db,
  DesignMetadata,
  GenerateRequestStatus,
  StoredGenerateRequestStatus,
  UpsertDesignParams,
} from "./interface";

let db: Db;

switch (env.DB_PROVIDER) {
  case "postgres": {
    if (!env.POSTGRES_DATABASE_URL) {
      throw new Error("POSTGRES_DATABASE_URL is required when DB_PROVIDER is set to postgres");
    }
    db = new PostgresDb(env.POSTGRES_DATABASE_URL);
    break;
  }
  case "fs": {
    db = new FsDb();
    break;
  }
  case "memory": {
    db = new MemoryDb();
    break;
  }
  default:
    assertNever(env.DB_PROVIDER);
}

export function getDb(): Db {
  return db;
}
