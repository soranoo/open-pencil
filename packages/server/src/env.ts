import { createEnv } from '@t3-oss/env-core'
import * as z from 'zod'

import type { AIProviderID } from '@open-pencil/core'

export const env = createEnv({
  server: {
    PORT: z.coerce.number().min(1).default(8787),

    AI_PROVIDER_ID: z.enum([
      'openrouter',
      'anthropic',
      'openai',
      'google',
      'deepseek',
      'zai',
      'minimax',
      'openai-compatible',
      'anthropic-compatible'
    ] satisfies AIProviderID[]),
    AI_API_KEY: z.string().min(1),
    AI_MODEL_ID: z.string().min(1),

    // Required to be set when using a *-compatible provider (e.g. OpenAI-compatible, Anthropic-compatible, OpenRouter).
    AI_CUSTOM_MODEL_ID: z.string().min(1),
    AI_CUSTOM_BASE_URL: z.string().min(1),
    AI_CUSTOM_API_TYPE: z.enum(['completions', 'responses']).default('completions'),

    S3_ENDPOINT: z.string().min(1),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),

    /**
     * If true, the S3 client will use path-style URLs (e.g. `http://s3.amazonaws.com/bucket/key`) instead of virtual-hosted-style URLs (e.g. `http://bucket.s3.amazonaws.com/key`).
     *
     * This is necessary for some S3-compatible services (e.g. MinIO) that do not support virtual-hosted-style URLs.
     *
     * See: https://docs.aws.amazon.com/AmazonS3/latest/userguide/VirtualHosting.html
     */
    S3_FORCE_PATH_STYLE: z.boolean().default(true),

    DATABASE_URL: z.string().min(1),
    SESSION_TTL_MINUTES: z.number().min(1).default(30),

    CORS_ORIGIN: z.string().min(1)
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
  emptyStringAsUndefined: true
})
