'use client'

import { Button, Card, Chip, Spinner, TextArea, TextField } from '@heroui/react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { calculateCost, formatCost, formatTokenCount } from './lib/pricing'
import type { GenerationResult } from './lib/types'

const DEFAULT_PROMPT = 'Create a calm finance dashboard with a dark sidebar and three KPI cards.'

export default function HomePage() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)

  async function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!prompt.trim() || isPending) return

    setError(null)
    setResult(null)
    setIsPending(true)

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      })
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const message =
          typeof body === 'object' &&
          body !== null &&
          'error' in body &&
          typeof body.error === 'string'
            ? body.error
            : 'Generation failed.'
        throw new Error(message)
      }
      setResult(body as GenerationResult)
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Generation failed.')
    } finally {
      setIsPending(false)
    }
  }

  if (result) {
    return <ResultView result={result} onStartOver={() => setResult(null)} />
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_85%_15%,#dfead2_0,transparent_28%),#f4f5f0] text-[#17242b] font-sans">
      <header className="flex items-center justify-between gap-6 px-[clamp(20px,5vw,72px)] py-6 max-[520px]:px-5 max-[520px]:py-4.5">
        <div className="flex items-center gap-2.5 text-[15px] font-bold">
          <span className="grid size-7.5 place-items-center rounded-lg bg-[#17242b] text-[11px] text-[#c7e86b]">
            OP
          </span>
          <span>OpenPencil</span>
          <span className="text-[#6b777b] font-medium max-[520px]:hidden">/</span>
          <span className="text-[#6b777b] font-medium max-[520px]:hidden">Prompt Studio</span>
        </div>
        <Chip size="sm" variant="soft" color="accent">
          SERVER ROUTED
        </Chip>
      </header>

      <section className="mx-auto grid max-w-310 min-h-[calc(100vh-86px)] grid-cols-[minmax(0,.9fr)_minmax(360px,1.1fr)] items-center gap-[clamp(40px,9vw,150px)] px-[clamp(20px,5vw,72px)] pt-12 pb-22.5 max-[860px]:grid-cols-1 max-[860px]:min-h-auto max-[860px]:pt-18 max-[520px]:px-5 max-[520px]:pt-11 max-[520px]:pb-15">
        <div className="max-w-132.5 max-[860px]:max-w-none">
          <p className="m-0 mb-4 text-[11px] font-extrabold uppercase text-[#ee705e]">
            Design generation workspace
          </p>
          <h1 className="m-0 mb-6 max-w-147.5 text-[clamp(42px,6vw,76px)] leading-[.96] max-[860px]:max-w-170 max-[520px]:text-5xl">
            Make the first draft feel inevitable.
          </h1>
          <p className="m-0 max-w-112.5 text-[18px] leading-[1.55] text-[#6b777b] max-[520px]:text-base">
            Describe a screen, a flow, or a visual system. OpenPencil will turn the thought into an
            editable canvas.
          </p>
          <div className="mt-10.5 grid gap-3 text-[13px]" aria-label="Generation details">
            <span className="flex items-center gap-2.5">
              <i className="size-2.25 shrink-0 rounded-full bg-[#ee705e]" />
              Editable canvas output
            </span>
            <span className="flex items-center gap-2.5">
              <i className="size-2.25 shrink-0 rounded-full bg-[#c7e86b]" />
              Usage tracked per request
            </span>
            <span className="flex items-center gap-2.5">
              <i className="size-2.25 shrink-0 rounded-full bg-[#8bb9e8]" />
              Provider keys stay on the server
            </span>
          </div>
        </div>

        <Card className="rounded-[20px] border border-[#d8ded9] bg-[#fffffff2] shadow-[0_24px_70px_#34443a1c]">
          <form className="grid gap-5.5" onSubmit={submitPrompt}>
            <Card.Header className="p-0 pb-0.5">
              <Card.Title className="text-2xl text-[#17242b]">What are we making?</Card.Title>
              <Card.Description className="text-[#6b777b]">
                Start with the user, the job, and the mood.
              </Card.Description>
            </Card.Header>
            <Card.Content className="p-0">
              <TextField
                isRequired
                className="[&>textarea]:min-h-42.5 [&>textarea]:border [&>textarea]:border-[#d8ded9] [&>textarea]:bg-[#f8faf6] [&>textarea]:text-[#17242b] [&>textarea]:leading-normal"
              >
                <TextArea
                  aria-label="Design prompt"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="A product page for..."
                  rows={6}
                />
              </TextField>
              {error ? (
                <p className="m-0 mt-3 text-[13px] text-[#ba3f35]" role="alert">
                  {error}
                </p>
              ) : null}
            </Card.Content>
            <Card.Footer className="flex items-center justify-between gap-4.5 p-0">
              <span className="text-xs text-[#6b777b]">{prompt.length} characters</span>
              <Button
                type="submit"
                variant="primary"
                isPending={isPending}
                isDisabled={!prompt.trim()}
              >
                {isPending ? (
                  <>
                    <Spinner color="current" size="sm" />
                    Generating canvas
                  </>
                ) : (
                  'Generate canvas'
                )}
              </Button>
            </Card.Footer>
          </form>
        </Card>
      </section>
    </main>
  )
}

function ResultView({
  result,
  onStartOver
}: {
  result: GenerationResult
  onStartOver: () => void
}) {
  const { usage } = result

  return (
    <main className="min-h-screen bg-[#202e34] text-white font-sans">
      <header className="flex items-center justify-between gap-6 border-b border-[#ffffff1c] px-[clamp(20px,5vw,72px)] py-6 max-[520px]:px-5 max-[520px]:py-4.5">
        <div className="flex items-center gap-2.5 text-[15px] font-bold text-white">
          <span className="grid size-7.5 place-items-center rounded-lg bg-[#c7e86b] text-[11px] text-[#17242b]">
            OP
          </span>
          <span>OpenPencil</span>
          <span className="text-[#6b777b] font-medium max-[520px]:hidden">/</span>
          <span className="text-[#6b777b] font-medium max-[520px]:hidden">Generated canvas</span>
        </div>
        <Button variant="tertiary" onPress={onStartOver}>
          New prompt
        </Button>
      </header>
      <section className="mx-auto flex max-w-345 items-end justify-between gap-7 px-[clamp(20px,5vw,72px)] pt-12 pb-7 max-[860px]:block">
        <div>
          <p className="m-0 mb-4 text-[11px] font-extrabold uppercase text-[#ee705e]">
            Canvas ready
          </p>
          <h1 className="m-0 mb-3 text-[clamp(36px,5vw,64px)] leading-[.96]">
            Your design is alive.
          </h1>
          {/* <p className="m-0 max-w-172.5 text-[15px] leading-normal text-[#c0ccca]">
            {result.summary || 'Generated from your prompt.'}
          </p> */}
        </div>
        <Chip color="success" variant="soft">
          Editable in OpenPencil
        </Chip>
      </section>
      <div className="mx-auto h-[min(62vh,700px)] min-h-110 max-w-345 px-[clamp(20px,5vw,72px)] max-[520px]:h-[58vh] max-[520px]:min-h-95 max-[520px]:px-5">
        <iframe
          title="OpenPencil design editor"
          src={result.editorUrl}
          allow="clipboard-read; clipboard-write"
          className="size-full rounded-t-[14px] border border-[#ffffff26] bg-[#e9ece8]"
        />
      </div>
      <section
        className="mx-auto grid max-w-345 grid-cols-[1.5fr_repeat(5,1fr)] items-center gap-4.5 px-[clamp(20px,5vw,72px)] pt-6.5 pb-10.5 max-[860px]:grid-cols-2 max-[520px]:gap-4.5 max-[520px]:px-5 max-[520px]:pt-5.5 max-[520px]:pb-8.5"
        aria-label="Token usage and estimated cost"
      >
        <div className="max-[860px]:col-span-2">
          <p className="m-0 mb-1.75 text-[11px] font-extrabold uppercase text-[#ee705e]">
            Request economics
          </p>
          <h2 className="m-0 text-xl">Token usage</h2>
        </div>
        <div className="grid gap-1.5 border-l border-[#ffffff26] pl-4.5 max-[520px]:pl-3">
          <span className="text-[11px] uppercase text-[#a8b7b4]">Input</span>
          <strong className="text-[17px]">{formatTokenCount(usage.inputTokens)}</strong>
        </div>
        <div className="grid gap-1.5 border-l border-[#ffffff26] pl-4.5 max-[520px]:pl-3">
          <span className="text-[11px] uppercase text-[#a8b7b4]">Cached input</span>
          <strong className="text-[17px]">{formatTokenCount(usage.cachedInputTokens)}</strong>
        </div>
        <div className="grid gap-1.5 border-l border-[#ffffff26] pl-4.5 max-[520px]:pl-3">
          <span className="text-[11px] uppercase text-[#a8b7b4]">Output</span>
          <strong className="text-[17px]">{formatTokenCount(usage.outputTokens)}</strong>
        </div>
        <div className="grid gap-1.5 border-l border-[#ffffff26] pl-4.5 max-[520px]:pl-3">
          <span className="text-[11px] uppercase text-[#a8b7b4]">Standard hours</span>
          <strong className="text-[17px] text-[#c7e86b]">
            {formatCost(calculateCost(usage, 'standard'))}
          </strong>
        </div>
        <div className="grid gap-1.5 border-l border-[#ffffff26] pl-4.5 max-[520px]:pl-3">
          <span className="text-[11px] uppercase text-[#a8b7b4]">Peak hours</span>
          <strong className="text-[17px] text-[#ee705e]">
            {formatCost(calculateCost(usage, 'peak'))}
          </strong>
        </div>
      </section>
    </main>
  )
}
