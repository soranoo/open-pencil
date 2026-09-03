import { randomBytes, randomUUID } from 'node:crypto'

import { Cluster } from 'puppeteer-cluster'

import { AsyncQueue } from './async-queue'
import { env as defaultEnv } from './env'
import { toAutomationError } from './errors'
import { RemoteControlHub } from './hub'
import { bootstrapPage, runSessionLoop, type SessionTask } from './session-task'
import { OpenPencilSession } from './session'
import type {
  AIModelConfig,
  AIModelConfigResult,
  AIResult,
  ConnectOptions,
  DownloadFigOptions,
  FigFile,
  GenerateOptions,
  GeneratedDesign,
  SendAIOptions,
  SessionOptions
} from './types'

interface ResolvedConfig {
  url: string
  hubHost: string
  hubPort: number
  token: string
  signingKey: string
  headless: boolean
  viewport: { width: number; height: number }
  concurrency: number
  readyTimeoutMs: number
  aiTimeoutMs: number
  downloadTimeoutMs: number
  configureTimeoutMs: number
  aiModel: AIModelConfig | null
  forwardConsole: boolean
  browserArgs: string[]
}

function aiModelFromEnv(): AIModelConfig | null {
  if (!defaultEnv.OPENPENCIL_AI_PROVIDER || !defaultEnv.OPENPENCIL_AI_TOKEN) return null
  return {
    providerID: defaultEnv.OPENPENCIL_AI_PROVIDER,
    modelID: defaultEnv.OPENPENCIL_AI_MODEL,
    customModelID: defaultEnv.OPENPENCIL_AI_CUSTOM_MODEL,
    customBaseURL: defaultEnv.OPENPENCIL_AI_BASE_URL,
    customAPIType: defaultEnv.OPENPENCIL_AI_API_TYPE,
    apiKey: defaultEnv.OPENPENCIL_AI_TOKEN,
    maxOutputTokens: defaultEnv.OPENPENCIL_AI_MAX_OUTPUT_TOKENS,
    name: defaultEnv.OPENPENCIL_AI_MODEL_NAME
  }
}

function resolveConfig(options: ConnectOptions): ResolvedConfig {
  return {
    url: options.url ?? defaultEnv.OPENPENCIL_URL,
    hubHost: options.hubHost ?? defaultEnv.OPENPENCIL_REMOTE_CONTROL_HOST,
    hubPort: options.hubPort ?? defaultEnv.OPENPENCIL_REMOTE_CONTROL_PORT,
    token: options.token ?? defaultEnv.OPENPENCIL_REMOTE_CONTROL_TOKEN ?? randomBytes(32).toString('hex'),
    signingKey: randomBytes(32).toString('hex'),
    headless: options.headless ?? defaultEnv.OPENPENCIL_HEADLESS,
    viewport: options.viewport ?? {
      width: defaultEnv.OPENPENCIL_VIEWPORT_WIDTH,
      height: defaultEnv.OPENPENCIL_VIEWPORT_HEIGHT
    },
    concurrency: options.concurrency ?? defaultEnv.OPENPENCIL_MAX_CONCURRENCY,
    readyTimeoutMs: options.readyTimeoutMs ?? defaultEnv.OPENPENCIL_READY_TIMEOUT_MS,
    aiTimeoutMs: options.aiTimeoutMs ?? defaultEnv.OPENPENCIL_AI_TIMEOUT_MS,
    downloadTimeoutMs: options.downloadTimeoutMs ?? defaultEnv.OPENPENCIL_DOWNLOAD_TIMEOUT_MS,
    configureTimeoutMs: options.configureTimeoutMs ?? defaultEnv.OPENPENCIL_AI_CONFIGURE_TIMEOUT_MS,
    aiModel: options.aiModel === undefined ? aiModelFromEnv() : options.aiModel,
    forwardConsole: options.forwardConsole ?? true,
    browserArgs: options.browserArgs ?? []
  }
}

type ClusterJobData = { sessionId: string; queue: AsyncQueue<SessionTask>; url: string }

/**
 * High-level, typed entry point for server-side automation of Open-Pencil.
 *
 * ```ts
 * const client = await OpenPencilAutomation.connect({ url: 'http://localhost:1420' })
 * const { result, figFile } = await client.generate({
 *   prompt: 'Create a modern SaaS landing page...'
 * })
 * // generate() closes the browser page after the .fig download completes.
 * await client.close()
 * ```
 *
 * For concurrent design generation, open multiple independent sessions:
 *
 * ```ts
 * const client = await OpenPencilAutomation.connect({ url: 'http://localhost:1420', concurrency: 3 })
 * const sessions = await Promise.all([client.createSession(), client.createSession(), client.createSession()])
 * const results = await Promise.all(sessions.map((s, i) => s.sendAI({ prompt: prompts[i] })))
 * await Promise.all(sessions.map((s) => s.close()))
 * await client.close()
 * ```
 */
export class OpenPencilAutomation {
  private readonly sessions = new Set<OpenPencilSession>()
  private defaultSessionPromise: Promise<OpenPencilSession> | null = null
  private closed = false

  private constructor(
    private readonly config: ResolvedConfig,
    private readonly hub: RemoteControlHub,
    private readonly cluster: Cluster<ClusterJobData, void>
  ) {}

  static async connect(options: ConnectOptions = {}): Promise<OpenPencilAutomation> {
    const config = resolveConfig(options)

    const hub = new RemoteControlHub({
      host: config.hubHost,
      port: config.hubPort,
      token: config.token,
      signingKey: config.signingKey
    })
    const bound = await hub.start()
    // Reflect the actually-bound port (relevant when hubPort was 0/"pick a free port").
    config.hubPort = bound.port

    let cluster: Cluster<ClusterJobData, void>
    try {
      cluster = await Cluster.launch({
        concurrency: Cluster.CONCURRENCY_CONTEXT,
        maxConcurrency: config.concurrency,
        // Sessions are long-lived (they stay open across multiple sequential
        // calls until `.close()`), so the cluster-level timeout is just a
        // generous safety ceiling. Real bounds are enforced per-operation via
        // readyTimeoutMs / aiTimeoutMs / downloadTimeoutMs.
        timeout: 1000 * 60 * 60 * 24,
        puppeteerOptions: {
          headless: config.headless,
          defaultViewport: config.viewport,
          args: [`--window-size=${config.viewport.width},${config.viewport.height}`, ...config.browserArgs]
        }
      })
    } catch (error) {
      await hub.stop().catch(() => undefined)
      throw toAutomationError(
        'CLUSTER_ERROR',
        error,
        'Failed to launch puppeteer-cluster. Do you have a Chromium build available (bunx puppeteer browsers install chrome)?'
      )
    }

    cluster.on('taskerror', (error: Error, data: ClusterJobData | undefined) => {
      console.warn(`[Automation] Session ${data?.sessionId ?? '?'} task error:`, error.message)
    })

    await cluster.task(async ({ page, data }) => {
      await bootstrapPage(page, {
        url: data.url,
        hubHost: config.hubHost,
        hubPort: config.hubPort,
        token: config.token,
        signingKey: config.signingKey,
        sessionId: data.sessionId,
        viewport: config.viewport,
        readyTimeoutMs: config.readyTimeoutMs,
        forwardConsole: config.forwardConsole
      })
      await hub.waitForRegistration(data.sessionId, config.readyTimeoutMs)
      await runSessionLoop(page, hub, data.sessionId, data.queue)
    })

    return new OpenPencilAutomation(config, hub, cluster)
  }

  /** Open a new, independent browser session (own page/context + hub connection). */
  async createSession(options: SessionOptions = {}): Promise<OpenPencilSession> {
    this.assertOpen()
    const sessionId = randomUUID()
    const queue = new AsyncQueue<SessionTask>()

    let session: OpenPencilSession | undefined
    const donePromise = this.cluster
      .execute({ sessionId, queue, url: options.url ?? this.config.url })
      .catch((error: unknown) => {
        // Command-level failures already propagate through hub.sendCommand
        // rejections; this only guards against an unhandled rejection from
        // the cluster's own task promise (e.g. bootstrap failure).
        const sessionError = toAutomationError(
          'CLUSTER_ERROR',
          error,
          `Automation session ${sessionId} failed`
        )
        session?.fail(sessionError)
        console.warn(
          `[Automation] Session ${sessionId} task ended with error:`,
          sessionError.message
        )
      })

    session = new OpenPencilSession(
      sessionId,
      {
        aiTimeoutMs: this.config.aiTimeoutMs,
        downloadTimeoutMs: this.config.downloadTimeoutMs,
        configureTimeoutMs: this.config.configureTimeoutMs
      },
      queue,
      donePromise,
      () => this.sessions.delete(session)
    )
    this.sessions.add(session)

    // aiModel: undefined -> use the connect()-level default (env or ConnectOptions.aiModel).
    // aiModel: null      -> explicitly skip auto-configuration for this session.
    const aiModel = options.aiModel === undefined ? this.config.aiModel : options.aiModel
    if (aiModel) {
      await session.configureAI(aiModel)
    }

    return session
  }

  private async getDefaultSession(): Promise<OpenPencilSession> {
    this.assertOpen()
    if (!this.defaultSessionPromise) this.defaultSessionPromise = this.createSession()
    return this.defaultSessionPromise
  }

  /** Convenience: sends on a lazily-created default session. Use `createSession()` for concurrency. */
  async sendAI(options: SendAIOptions): Promise<AIResult> {
    const session = await this.getDefaultSession()
    return session.sendAI(options)
  }

  /** Generates and downloads one design, then closes the default session page. */
  async generate(options: GenerateOptions): Promise<GeneratedDesign> {
    const session = await this.getDefaultSession()
    try {
      return await session.generate(options)
    } finally {
      this.defaultSessionPromise = null
    }
  }

  /** Convenience: reconfigures the default session's AI model on demand. */
  async configureAI(config: AIModelConfig): Promise<AIModelConfigResult> {
    const session = await this.getDefaultSession()
    return session.configureAI(config)
  }

  /** Convenience: downloads from the default session. Use `createSession()` for concurrency. */
  async downloadFig(options?: DownloadFigOptions): Promise<FigFile> {
    const session = await this.getDefaultSession()
    return session.downloadFig(options)
  }

  /** Closes every open session, the cluster, and the hub. Safe to call multiple times. */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await Promise.all([...this.sessions].map((session) => session.close().catch(() => undefined)))
    await this.cluster.idle().catch(() => undefined)
    await this.cluster.close().catch(() => undefined)
    await this.hub.stop().catch(() => undefined)
  }

  private assertOpen(): void {
    if (this.closed) {
      throw toAutomationError('CLIENT_CLOSED', new Error('This OpenPencilAutomation client has been closed'), 'Client closed')
    }
  }
}
