import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

import { AsyncQueue } from './async-queue'
import { OpenPencilAutomationError } from './errors'
import type { AIConfigureResult, AIRequestResult, FigDownloadResult } from './protocol'
import type { SessionTask } from './session-task'
import type {
  AIModelConfig,
  AIModelConfigResult,
  AIResult,
  AIStreamEvent,
  DownloadFigOptions,
  FigFile,
  GenerateOptions,
  GeneratedDesign,
  SendAIOptions
} from './types'

interface SessionRuntimeConfig {
  aiTimeoutMs: number
  downloadTimeoutMs: number
  configureTimeoutMs: number
}

/**
 * One browser page/context, connected to exactly one remote-control session
 * on the hub. Sequential calls on the same session (e.g. `sendAI` then
 * `downloadFig`) reuse the same page. Independent sessions run concurrently
 * (see `OpenPencilAutomation.createSession`), each in its own isolated
 * browser context via puppeteer-cluster's `CONCURRENCY_CONTEXT` mode.
 */
export class OpenPencilSession {
  readonly id: string
  private closed = false

  constructor(
    id: string,
    private readonly config: SessionRuntimeConfig,
    private readonly queue: AsyncQueue<SessionTask>,
    private readonly donePromise: Promise<void>,
    private readonly onClosed: () => void
  ) {
    this.id = id
  }

  /** Send a design/AI request and await the final result, streaming via `onEvent`. */
  async sendAI(options: SendAIOptions): Promise<AIResult> {
    const { events, result } = this.runAI(options)
    const drain = options.onEvent
      ? (async () => {
          for await (const event of events) options.onEvent?.(event)
        })()
      : (async () => {
          for await (const _event of events) {
            /* nobody is listening; drain so the internal queue doesn't grow unbounded */
          }
        })()
    const [finalResult] = await Promise.all([result, drain.catch(() => undefined)])
    return finalResult
  }

  /** Generate and download a design, then close this session's page/context. */
  async generate(options: GenerateOptions): Promise<GeneratedDesign> {
    try {
      const result = await this.sendAI(options)
      const figFile = await this.downloadFig(options.download)
      return { result, figFile }
    } finally {
      await this.close()
    }
  }

  /** Same request, but exposed as an async iterator instead of a callback. */
  streamAI(options: SendAIOptions): { events: AsyncIterable<AIStreamEvent>; result: Promise<AIResult> } {
    return this.runAI(options)
  }

  private runAI(options: SendAIOptions): { events: AsyncIterable<AIStreamEvent>; result: Promise<AIResult> } {
    this.assertOpen()
    if (!options.prompt || typeof options.prompt !== 'string') {
      throw new OpenPencilAutomationError('INVALID_PAYLOAD', '`prompt` is required and must be a string')
    }

    const requestId = randomUUID()
    const eventQueue = new AsyncQueue<AIStreamEvent | null>()
    let textSoFar = ''

    const onEvent = (event: string, payload: unknown) => {
      const p = (payload ?? {}) as { textDelta?: string; textSoFar?: string; prompt?: string }
      if (event === 'start') {
        eventQueue.push({ type: 'start', prompt: p.prompt ?? options.prompt })
      } else if (event === 'stream' && (p.textDelta?.length ?? 0) > 0) {
        textSoFar = p.textSoFar ?? textSoFar
        eventQueue.push({ type: 'delta', textDelta: p.textDelta ?? '', textSoFar })
      }
    }

    const commandResult = new Promise<AIRequestResult>((resolve, reject) => {
      this.queue.push({
        kind: 'ai',
        prompt: options.prompt,
        continueSession: options.continueSession ?? false,
        timeoutMs: options.timeoutMs ?? this.config.aiTimeoutMs,
        onEvent,
        resolve,
        reject
      })
    })

    const result: Promise<AIResult> = commandResult.then(
      (raw) => {
        eventQueue.push({ type: 'done', text: raw.text })
        eventQueue.push(null)
        return {
          sessionId: this.id,
          requestId,
          text: raw.text,
          finishReason: raw.finishReason,
          usage: raw.usage,
          toolCalls: raw.toolCalls,
          hitStepLimit: raw.hitStepLimit
        }
      },
      (error: unknown) => {
        eventQueue.push(null)
        throw error
      }
    )

    async function* iterate(): AsyncGenerator<AIStreamEvent> {
      for (;;) {
        const value = await eventQueue.next()
        if (value === null) return
        yield value
      }
    }

    return { events: iterate(), result }
  }

  /**
   * Point this session's AI chat at a custom endpoint/model/token (or a
   * named provider + model). Reuses the app's own model-settings store —
   * see src/app/automation/remote-control/handlers/configure.ts.
   */
  async configureAI(config: AIModelConfig, options: { timeoutMs?: number } = {}): Promise<AIModelConfigResult> {
    this.assertOpen()
    if (!config?.providerID) {
      throw new OpenPencilAutomationError('INVALID_PAYLOAD', '`providerID` is required')
    }
    return new Promise<AIConfigureResult>((resolve, reject) => {
      this.queue.push({
        kind: 'configure',
        config,
        timeoutMs: options.timeoutMs ?? this.config.configureTimeoutMs,
        resolve,
        reject
      })
    })
  }

  /** Request the current design as a `.fig` file. */
  async downloadFig(options: DownloadFigOptions = {}): Promise<FigFile> {
    this.assertOpen()
    const raw = await new Promise<FigDownloadResult>((resolve, reject) => {
      this.queue.push({
        kind: 'fig',
        timeoutMs: options.timeoutMs ?? this.config.downloadTimeoutMs,
        resolve,
        reject
      })
    })

    const bytes = Buffer.from(raw.base64, 'base64')
    if (options.saveToPath) {
      await writeFile(options.saveToPath, bytes)
    }

    return {
      filename: raw.filename,
      mimeType: raw.mimeType,
      bytes: new Uint8Array(bytes),
      byteLength: raw.byteLength
    }
  }

  /** Close this session's page/context and release cluster resources. */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.onClosed()
    await new Promise<void>((resolve) => {
      this.queue.push({ kind: 'close', resolve })
    })
    this.queue.close()
    await this.donePromise.catch(() => undefined)
  }

  /** Reject queued operations when the browser task fails before serving them. */
  fail(error: Error): void {
    if (this.closed) return
    this.closed = true
    this.onClosed()
    this.queue.fail(error, rejectSessionTask)
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new OpenPencilAutomationError('CLIENT_CLOSED', `Session "${this.id}" has already been closed`)
    }
  }
}

function rejectSessionTask(task: SessionTask, error: Error): void {
  if (task.kind === 'close') {
    task.resolve()
    return
  }
  task.reject(error)
}
