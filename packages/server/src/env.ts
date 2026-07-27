import type { AIProviderID } from "@open-pencil/core";
import { createEnv } from "@t3-oss/env-core";
import z from "zod";

export const env = createEnv({
  server: {
    PORT: z.coerce.number().min(1).default(8787),

    AI_PROVIDER_ID: z.enum([
      "openrouter",
      "anthropic",
      "openai",
      "google",
      "deepseek",
      "zai",
      "minimax",
      "openai-compatible",
      "anthropic-compatible",
    ] satisfies AIProviderID[]),
    AI_API_KEY: z.string().min(1),
    AI_MODEL_ID: z.string().min(1),

    // Required to be set when using a *-compatible provider (e.g. OpenAI-compatible, Anthropic-compatible, OpenRouter).
    AI_CUSTOM_BASE_URL: z.string().min(1).optional(),
    AI_CUSTOM_API_TYPE: z.enum(["completions", "responses"]).default("completions"),

    S3_ENDPOINT: z.string().min(1).optional(),
    // Required to be set if S3_ENDPOINT is filled
    S3_REGION: z.string().min(1).optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),

    /**
     * If true, the S3 client will use path-style URLs (e.g. `http://s3.amazonaws.com/bucket/key`) instead of virtual-hosted-style URLs (e.g. `http://bucket.s3.amazonaws.com/key`).
     *
     * This is necessary for some S3-compatible services (e.g. MinIO) that do not support virtual-hosted-style URLs.
     *
     * See: https://docs.aws.amazon.com/AmazonS3/latest/userguide/VirtualHosting.html
     */
    S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

    /**
     * Directory for local filesystem storage. Only used when S3_ENDPOINT is not set.
     */
    STORAGE_DIR: z.string().default("./tmp/data"),

    DB_PROVIDER: z.enum(["memory", "fs", "postgres"]).default("memory"),
    POSTGRES_DATABASE_URL: z.url().min(1).optional(),

    KV_PROVIDER: z.enum(["memory", "fs", "redis"]).default("memory"),
    REDIS_URL: z.url().optional(),
    SESSION_TTL_MINUTES: z.coerce.number().min(1).default(30),

    QUEUE_PROVIDER: z.enum(["memory", "fs", "amqp"]).default("memory"),
    AMQP_URL: z.url().optional(),
    AMQP_QUEUE_NAME: z.string().min(1).default("openpencil.generate"),
    AI_MAX_CONCURRENCY_PER_WORKER: z.coerce.number().int().min(1).default(1),

    CORS_ORIGIN: z.union([z.url(), z.array(z.url())]).default("http://localhost:1420"),
    FRONTEND_URL: z.url().default("http://localhost:1420"),
    ENABLE_OPENAPI_DOCS: z.coerce.boolean().default(false),
  },

  /**
   * What object holds the environment variables at runtime. This is usually
   * `process.env` or `import.meta.env`.
   */
  runtimeEnv: process.env,

  /**
   * By default, this library will feed the environment variables directly to
   * the Zod validator.
   *
   * This means that if you have an empty string for a value that is supposed
   * to be a number (e.g. `PORT=` in a ".env" file), Zod will incorrectly flag
   * it as a type mismatch violation. Additionally, if you have an empty string
   * for a value that is supposed to be a string with a default value (e.g.
   * `DOMAIN=` in an ".env" file), the default value will never be applied.
   *
   * In order to solve these issues, we recommend that all new projects
   * explicitly specify this option as true.
   */
  emptyStringAsUndefined: true,
});
