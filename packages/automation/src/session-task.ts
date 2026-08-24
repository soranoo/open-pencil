import type { Page } from 'puppeteer'

import type { AsyncQueue } from './async-queue'
import { OpenPencilAutomationError, toAutomationError } from './errors'
import type { RemoteControlHub } from './hub'
import {
  getRemoteControlSigningPayload,
  type AIConfigureResult,
  type AIRequestResult,
  type FigDownloadResult
} from './protocol'
import type { AIModelConfig } from './types'

import { createHmac } from 'node:crypto'

export interface PageBootstrapOptions {
  url: string
  hubHost: string
  hubPort: number
  token: string
  signingKey: string
  sessionId: string
  viewport: { width: number; height: number }
  readyTimeoutMs: number
  forwardConsole: boolean
}

/**
 * Puppeteer's responsibilities: open the page, set the viewport, navigate to
 * Open-Pencil with the remote-control query params, and wait for the
 * frontend to dial back into the hub and complete the auth handshake. This
 * handshake *is* the "app ready" signal — no DOM polling required.
 */
export async function bootstrapPage(page: Page, options: PageBootstrapOptions): Promise<void> {
  if (options.forwardConsole) {
    page.on('console', (msg) => {
      console.log(`[session:${options.sessionId.slice(0, 8)}] [console:${msg.type()}] ${msg.text()}`)
    })
  }
  page.on('pageerror', (error) => {
    console.warn(
      `[session:${options.sessionId.slice(0, 8)}] page error:`,
      error instanceof Error ? error.message : String(error)
    )
  })
  page.on('requestfailed', (request) => {
    // Non-fatal: log only. Asset/font failures shouldn't abort the session.
    console.warn(
      `[session:${options.sessionId.slice(0, 8)}] request failed: ${request.url()} (${request.failure()?.errorText})`
    )
  })

  await page.setViewport({ width: options.viewport.width, height: options.viewport.height })

  const target = new URL(options.url)
  const remoteControlEnabled = '1'
  target.searchParams.set('op-remote-control', remoteControlEnabled)
  target.searchParams.set('op-remote-control-host', options.hubHost)
  target.searchParams.set('op-remote-control-port', String(options.hubPort))
  target.searchParams.set('op-remote-control-token', options.token)
  target.searchParams.set('op-remote-control-session', options.sessionId)
  target.searchParams.set(
    'op-remote-control-sign',
    createHmac('sha256', options.signingKey)
      .update(
        getRemoteControlSigningPayload({
          enabled: remoteControlEnabled,
          host: options.hubHost,
          port: options.hubPort,
          token: options.token,
          sessionId: options.sessionId
        })
      )
      .digest('base64url')
  )

  try {
    await page.goto(target.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: options.readyTimeoutMs
    })
  } catch (error) {
    throw new OpenPencilAutomationError(
      'PAGE_LOAD_FAILED',
      `Failed to load Open-Pencil at ${options.url}. Is the dev server running ` +
        `(bun run dev)? Underlying error: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    )
  }
}

export type SessionTask =
  | {
      kind: 'ai'
      prompt: string
      continueSession: boolean
      timeoutMs: number
      onEvent?: (event: string, payload: unknown) => void
      resolve: (result: AIRequestResult) => void
      reject: (error: Error) => void
    }
  | {
      kind: 'configure'
      config: AIModelConfig
      timeoutMs: number
      resolve: (result: AIConfigureResult) => void
      reject: (error: Error) => void
    }
  | {
      kind: 'fig'
      timeoutMs: number
      resolve: (result: FigDownloadResult) => void
      reject: (error: Error) => void
    }
  | { kind: 'close'; resolve: () => void }

/**
 * Long-running loop that keeps one browser session's task "held open" inside
 * a single `cluster.execute()` call so the page can be reused across
 * multiple sequential operations (sendAI, then downloadFig, ...) instead of
 * being torn down after each one. Exits when a `close` task is dequeued, or
 * immediately if the page crashes/closes.
 */
export async function runSessionLoop(
  page: Page,
  hub: RemoteControlHub,
  sessionId: string,
  queue: AsyncQueue<SessionTask>
): Promise<void> {
  const crashed = new Promise<never>((_, reject) => {
    page.once('close', () =>
      reject(new OpenPencilAutomationError('BROWSER_CRASHED', 'Page closed unexpectedly'))
    )
    page.once('error', (error) =>
      reject(
        new OpenPencilAutomationError('BROWSER_CRASHED', `Page crashed: ${error.message}`, { cause: error })
      )
    )
  })
  // Prevent "unhandled rejection" noise; we only ever consume it via race().
  crashed.catch(() => undefined)

  for (;;) {
    let task: SessionTask
    try {
      task = await Promise.race([queue.next(), crashed])
    } catch (error) {
      if (error instanceof OpenPencilAutomationError) throw error
      return
    }

    if (task.kind === 'close') {
      task.resolve()
      return
    }

    if (task.kind === 'ai') {
      try {
        const result = await hub.sendCommand<AIRequestResult>(
          sessionId,
          'ai.request',
          { prompt: task.prompt, continueSession: task.continueSession },
          { timeoutMs: task.timeoutMs, onEvent: task.onEvent }
        )
        task.resolve(result)
      } catch (error) {
        task.reject(toAutomationError('AI_REQUEST_FAILED', error, 'AI request failed'))
      }
    } else if (task.kind === 'configure') {
      try {
        const result = await hub.sendCommand<AIConfigureResult>(
          sessionId,
          'ai.configure',
          task.config,
          { timeoutMs: task.timeoutMs }
        )
        task.resolve(result)
      } catch (error) {
        task.reject(toAutomationError('AI_CONFIGURE_FAILED', error, 'AI model configuration failed'))
      }
    } else {
      try {
        const result = await hub.sendCommand<FigDownloadResult>(
          sessionId,
          'fig.download',
          {},
          { timeoutMs: task.timeoutMs }
        )
        task.resolve(result)
      } catch (error) {
        task.reject(toAutomationError('DOWNLOAD_FAILED', error, '.fig download failed'))
      }
    }
  }
}
