import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

/**
 * Strongly-typed, validated environment for the automation package.
 * Uses `@t3-oss/env-core` (the framework-agnostic T3 env), not the Next.js
 * variant, since this package runs as a plain Node/Bun script.
 *
 * Copy `.env.example` to `.env` and adjust as needed. Values here are only
 * defaults; every field can be overridden per-call via
 * `OpenPencilAutomation.connect({ ...overrides })`.
 */
export const env = createEnv({
  server: {
    /** Where the Open-Pencil dev server (vite) is already running. */
    OPENPENCIL_URL: z.string().url().default('http://localhost:1420'),

    /** Host the remote-control hub binds its WebSocket server to. */
    OPENPENCIL_REMOTE_CONTROL_HOST: z.string().min(1).default('127.0.0.1'),

    /** Port for the hub. 0 = ask the OS for a free port (recommended). */
    OPENPENCIL_REMOTE_CONTROL_PORT: z.coerce.number().int().min(0).max(65535).default(0),

    /**
     * Shared secret the frontend must present when it connects to the hub.
     * If unset, a random 32-byte hex token is generated per process.
     */
    OPENPENCIL_REMOTE_CONTROL_TOKEN: z.string().min(16).optional(),

    /** Run Chromium with a visible window (recommended for debugging). */
    OPENPENCIL_HEADLESS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),

    OPENPENCIL_VIEWPORT_WIDTH: z.coerce.number().int().positive().default(1980),
    OPENPENCIL_VIEWPORT_HEIGHT: z.coerce.number().int().positive().default(1080),

    /** Max number of concurrent browser sessions the cluster will run. */
    OPENPENCIL_MAX_CONCURRENCY: z.coerce.number().int().positive().default(4),

    /** How long to wait for the Open-Pencil page to load and register with the hub. */
    OPENPENCIL_READY_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

    /** How long to wait for an AI request to complete before timing out. */
    OPENPENCIL_AI_TIMEOUT_MS: z.coerce.number().int().positive().default(3_600_000),

    /** How long to wait for a .fig export to complete before timing out. */
    OPENPENCIL_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),

    /** How long to wait for an ai.configure command to complete before timing out. */
    OPENPENCIL_AI_CONFIGURE_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

    // -- AI model configuration --------------------------------------------
    // Set these to point Open-Pencil's AI chat at a custom endpoint/model/token
    // automatically on every session, without touching the app's Settings UI.
    // Leave OPENPENCIL_AI_PROVIDER unset to skip auto-configuration entirely
    // (the browser session's own persisted/manually-configured provider is
    // used instead). All of these can also be overridden per-call via
    // OpenPencilAutomation.connect({ aiModel: {...} }) or
    // session.configureAI({...}).

    /** e.g. 'openai-compatible', 'anthropic-compatible', 'openai', 'anthropic', 'google', 'deepseek', 'zai', 'minimax', 'openrouter'. */
    OPENPENCIL_AI_PROVIDER: z.string().optional(),
    /** Built-in model id for named providers (e.g. 'claude-sonnet-4-6-20260301'). */
    OPENPENCIL_AI_MODEL: z.string().optional(),
    /** Free-form model id, used with 'openai-compatible' / 'anthropic-compatible' or to override a named provider's model list. */
    OPENPENCIL_AI_CUSTOM_MODEL: z.string().optional(),
    /** Custom endpoint base URL. Only meaningful for 'openai-compatible' / 'anthropic-compatible'. */
    OPENPENCIL_AI_BASE_URL: z.string().url().optional(),
    OPENPENCIL_AI_API_TYPE: z.enum(['completions', 'responses']).optional(),
    /** API key / token sent to the provider. */
    OPENPENCIL_AI_TOKEN: z.string().optional(),
    OPENPENCIL_AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().optional().default(384_000),
    OPENPENCIL_AI_MODEL_NAME: z.string().optional()
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true
})

export type AutomationEnv = typeof env
