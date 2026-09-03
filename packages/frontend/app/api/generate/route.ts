import { NextResponse } from 'next/server'

import type { GenerationResult, UsageSummary } from '../../lib/types'

const POLL_INTERVAL_MS = 1_000
const POLL_TIMEOUT_MS = 15 * 60 * 1_000

interface GenerateStatusResponse {
  error: string | null
  result: {
    designId: string
    summary: string
    usage: {
      inputTokens?: number
      inputTokenDetails?: { cacheReadTokens?: number }
      outputTokens?: number
      totalTokens?: number
      cachedInputTokens?: number
    }
  } | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getErrorMessage(value: unknown, fallback: string): string {
  if (isRecord(value) && typeof value.error === 'string') return value.error
  return fallback
}

function getApiBaseUrl(): string {
  return (process.env.OPENPENCIL_AUTOMATION_URL ?? 'http://localhost:8787').replace(/\/$/, '')
}

function getHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function normalizeUsage(result: GenerateStatusResponse['result']): UsageSummary {
  const usage = result?.usage
  const inputTokens = usage?.inputTokens ?? 0
  const cachedInputTokens =
    usage?.cachedInputTokens ?? usage?.inputTokenDetails?.cacheReadTokens ?? 0
  const outputTokens = usage?.outputTokens ?? 0

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens: usage?.totalTokens ?? inputTokens + outputTokens
  }
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null)
}

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.OPENPENCIL_SERVER_API_KEY ?? process.env.SERVER_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'The frontend server is missing OPENPENCIL_SERVER_API_KEY.' },
      { status: 500 }
    )
  }

  const body = await request.json().catch(() => null)
  if (!isRecord(body) || typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
    return NextResponse.json({ error: 'Prompt is required.' }, { status: 400 })
  }

  const apiBaseUrl = getApiBaseUrl()
  const headers = getHeaders(apiKey)

  try {
    const enqueueResponse = await fetch(`${apiBaseUrl}/api/v1/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: body.prompt.trim(), autosave: true }),
      cache: 'no-store'
    })
    const enqueueBody = await readJson(enqueueResponse)
    if (
      !enqueueResponse.ok ||
      !isRecord(enqueueBody) ||
      typeof enqueueBody.requestId !== 'string'
    ) {
      return NextResponse.json(
        { error: getErrorMessage(enqueueBody, 'Unable to queue the design request.') },
        { status: enqueueResponse.status || 502 }
      )
    }

    const requestId = enqueueBody.requestId
    const deadline = Date.now() + POLL_TIMEOUT_MS
    let status: GenerateStatusResponse | null = null

    while (Date.now() < deadline) {
      const statusResponse = await fetch(
        `${apiBaseUrl}/api/v1/generate/status/${encodeURIComponent(requestId)}`,
        { headers, cache: 'no-store' }
      )
      const statusBody = await readJson(statusResponse)
      if (!statusResponse.ok) {
        return NextResponse.json(
          { error: getErrorMessage(statusBody, 'Unable to read generation status.') },
          { status: statusResponse.status || 502 }
        )
      }

      status = statusBody as GenerateStatusResponse
      if (status.error) return NextResponse.json({ error: status.error }, { status: 502 })
      if (status.result) break
      await wait(POLL_INTERVAL_MS)
    }

    if (!status?.result) {
      return NextResponse.json(
        { error: 'Generation timed out. Please try again.' },
        { status: 504 }
      )
    }

    const editorResponse = await fetch(
      `${apiBaseUrl}/api/v1/design/${encodeURIComponent(status.result.designId)}/url?permission=read`,
      { headers, cache: 'no-store' }
    )
    const editorBody = await readJson(editorResponse)
    if (!editorResponse.ok || !isRecord(editorBody) || typeof editorBody.url !== 'string') {
      return NextResponse.json(
        { error: getErrorMessage(editorBody, 'Unable to create the editor link.') },
        { status: editorResponse.status || 502 }
      )
    }

    const result: GenerationResult = {
      designId: status.result.designId,
      editorUrl: editorBody.url,
      summary: status.result.summary,
      usage: normalizeUsage(status.result)
    }

    return NextResponse.json(result)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'The generation service is unavailable.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
