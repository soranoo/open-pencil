// This file replaces chat-engine.ts (upstream headless tool-calling loop) and
// headless-tools.ts / model.ts / *-guardrail.ts (its supporting cast). Instead
// of running its own AI SDK agent loop against an in-memory SceneGraph, it
// drives the *real* Open-Pencil web app in a real browser via
// @open-pencil/automation — same app, same AI chat pipeline, same .fig
// exporter a human user gets. See packages/automation-server/README.md for
// the full write-up of what changed and why.
//
// A browser session is used for one generation and then closed completely.
// The generated .fig bytes are persisted by generate.ts, so the server does
// not keep a page alive while another request is waiting for a browser slot.

import {
  OpenPencilAutomation,
  OpenPencilAutomationError,
  type AIModelConfig,
  type AIRequestToolCall,
  type AIRequestUsage,
  type OpenPencilSession
} from "@open-pencil/automation";

import { getDb } from "@/db/index.js";
import { createSignedDesignUrl } from "@/design-auth.js";
import { env } from "@/env.js";

export class DesignSessionUnavailableError extends Error {
  constructor(designId: string) {
    super(
      `Design "${designId}" has no saved document. Each generation closes its browser page, ` +
        `so save it with POST /design/${designId}/save before generating it again.`
    );
    this.name = "DesignSessionUnavailableError";
  }
}

export interface RunAutomationPromptParams {
  designId: string;
  prompt: string;
  isNewDesign: boolean;
  logContext?: { requestId?: string };
}

export interface RunAutomationPromptResult {
  text: string;
  finishReason: string;
  usage: AIRequestUsage;
  toolCalls: AIRequestToolCall[];
  /** Current .fig bytes for the design, downloaded right after generation. */
  figBytes: Uint8Array;
}

const designLocks = new Map<string, Promise<unknown>>();

let clientPromise: Promise<OpenPencilAutomation> | null = null;

function getClient(): Promise<OpenPencilAutomation> {
  clientPromise ??= OpenPencilAutomation.connect({
    // Everything else (URL, headless, concurrency, aiModel, timeouts) is
    // read from @open-pencil/automation's own OPENPENCIL_* env vars — see
    // that package's .env.example. Kept separate from this server's env.ts
    // so browser/AI-model config lives in exactly one place.
    concurrency: env.AI_MAX_CONCURRENCY_PER_WORKER
  });
  return clientPromise;
}

/** Runs `fn` after any in-flight call for the same designId has settled. */
function withDesignLock<T>(designId: string, fn: () => Promise<T>): Promise<T> {
  const tail = designLocks.get(designId) ?? Promise.resolve();
  const run = tail.then(fn, fn);
  designLocks.set(
    designId,
    run.catch(() => undefined)
  );
  return run;
}

/** Same URL shape src/routes/frontend-url.ts hands out — 'read' is enough to load bytes. */
async function buildFrontendDesignUrl(designId: string): Promise<string> {
  const metadata = await getDb().getDesignMetadata(designId);
  if (!metadata) {
    throw new DesignSessionUnavailableError(designId);
  }
  const signed = createSignedDesignUrl(designId, "read");
  const url = new URL(env.FRONTEND_URL);
  url.searchParams.set("design", designId);
  url.searchParams.set("key", signed.accessKey);
  url.searchParams.set("expiry", String(signed.expiresAt));
  url.searchParams.set("permission", signed.permission);
  url.searchParams.set("sign", signed.signature);
  return url.toString();
}

async function createGenerationSession(designId: string, isNewDesign: boolean): Promise<OpenPencilSession> {
  const client = await getClient();
  return isNewDesign
    ? await client.createSession()
    : await client.createSession({ url: await buildFrontendDesignUrl(designId) });
}

export async function runAutomationPrompt(
  params: RunAutomationPromptParams
): Promise<RunAutomationPromptResult> {
  return withDesignLock(params.designId, async () => {
    const session = await createGenerationSession(params.designId, params.isNewDesign);

    try {
      const { result, figFile } = await session.generate({ prompt: params.prompt });

      return {
        text: result.text,
        finishReason: result.finishReason,
        usage: result.usage,
        toolCalls: result.toolCalls,
        figBytes: figFile.bytes
      };
    } catch (error) {
      console.error("[automation-engine] generation failed; browser session closed", {
        designId: params.designId,
        requestId: params.logContext?.requestId ?? null,
        error: error instanceof Error ? error.message : String(error)
      });
      if (error instanceof OpenPencilAutomationError) throw error;
      throw error;
    }
  });
}

/** Point every future session at a custom model/endpoint/token. Optional — see .env.example. */
export async function configureDefaultAIModel(config: AIModelConfig): Promise<void> {
  const client = await getClient();
  await client.configureAI(config);
}

/** Closes the automation client. Call on server shutdown. */
export async function shutdownAutomationEngine(): Promise<void> {
  if (clientPromise) {
    const client = await clientPromise;
    clientPromise = null;
    await client.close().catch(() => undefined);
  }
}
