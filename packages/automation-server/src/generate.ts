// Same public contract as upstream: GenerateRequest, GenerateResponse, generateResultSchema,
// DesignNotFoundError, processGenerateRequest(body, logContext) -> GenerateResponse.
// routes/generate.ts, schemas.ts, and queue/generate-worker.ts (all unchanged) only ever
// call through this contract, so none of them needed to change.
//
// Internals: instead of running an in-process AI SDK agent loop against an in-memory
// SceneGraph (chat-engine.ts / headless-tools.ts upstream), this drives a real browser
// session against the real Open-Pencil app via automation-engine.ts. The browser reports
// the app's ordered tool log and whether its configured step budget was reached.

import z from "zod";

import type { AIRequestUsage } from "@open-pencil/automation";

import { runAutomationPrompt } from "@/automation-engine.js";
import { getDb } from "@/db/index.js";
import { env } from "@/env.js";
import { createSession, getSession, putSessionDocBytes, recordGenerateTurn } from "@/session-manager.js";

export interface GenerateRequest {
  prompt: string;
  designId?: string;
  autosave?: boolean;
}

interface GenerateLogContext {
  requestId?: string;
}

const modelUsageSchema = z.object({
  inputTokens: z.union([z.number(), z.undefined()]),
  inputTokenDetails: z.object({
    noCacheTokens: z.union([z.number(), z.undefined()]),
    cacheReadTokens: z.union([z.number(), z.undefined()]),
    cacheWriteTokens: z.union([z.number(), z.undefined()]),
  }),
  outputTokens: z.union([z.number(), z.undefined()]),
  outputTokenDetails: z.object({
    textTokens: z.union([z.number(), z.undefined()]),
    reasoningTokens: z.union([z.number(), z.undefined()]),
  }),
  totalTokens: z.union([z.number(), z.undefined()]),
  reasoningTokens: z.number().optional(),
  cachedInputTokens: z.number().optional(),
});

const toolLogSchema = z.object({
  tool: z.string(),
  mutates: z.boolean(),
});

export const generateResultSchema = z.object({
  designId: z.string(),
  summary: z.string(),
  toolCallCount: z.number(),
  hitStepLimit: z.boolean(),
  timeUsedMs: z.number().int().min(0),
  toolLog: z.array(toolLogSchema),
  usage: modelUsageSchema,
});

export type GenerateResponse = z.infer<typeof generateResultSchema>;

export class DesignNotFoundError extends Error {
  constructor(designId: string) {
    super(`No saved design found for ${designId}`);
    this.name = "DesignNotFoundError";
  }
}

/** Reshapes @open-pencil/automation's flat usage into the nested shape modelUsageSchema expects. */
function toModelUsageShape(usage: AIRequestUsage): z.infer<typeof modelUsageSchema> {
  return {
    inputTokens: usage.inputTokens,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
    },
    outputTokens: usage.outputTokens,
    outputTokenDetails: {
      textTokens: undefined,
      reasoningTokens: undefined,
    },
    totalTokens: usage.totalTokens,
  };
}

function stubResult(designId: string): GenerateResponse {
  return {
    designId,
    summary: "dev",
    toolCallCount: 0,
    hitStepLimit: false,
    timeUsedMs: 0,
    toolLog: [],
    usage: toModelUsageShape({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
    }),
  };
}

export async function processGenerateRequest(
  body: GenerateRequest,
  logContext?: GenerateLogContext,
): Promise<GenerateResponse> {
  const isNewDesign = !body.designId;
  const designId = body.designId ?? (await createSession()).id;

  if (!isNewDesign) {
    // Mirrors upstream's session-or-permanent-storage existence check, minus the
    // in-memory graph load (the browser owns that now — see automation-engine.ts).
    const existing = await getSession(designId);
    if (!existing) {
      const metadata = await getDb().getDesignMetadata(designId);
      if (!metadata) {
        throw new DesignNotFoundError(designId);
      }
      await createSession(designId);
    }
  }

  const startedAt = Date.now();

  let result;
  if (env.USE_AI_STUB) {
    result = stubResult(designId);
  } else {
    const automationResult = await runAutomationPrompt({
      designId,
      prompt: body.prompt,
      isNewDesign,
      logContext: { requestId: logContext?.requestId },
    });

    await recordGenerateTurn(designId, body.prompt, automationResult.text);
    await putSessionDocBytes(designId, automationResult.figBytes);

    console.log("[generate] automation result", {
      designId,
      requestId: logContext?.requestId ?? null,
      toolCallCount: automationResult.toolCalls?.length ?? 0,
      finishReason: automationResult.finishReason,
      hitStepLimit: automationResult.hitStepLimit,
      usage: automationResult.usage,
    });
    const toolCalls = automationResult.toolCalls ?? [];
    result = {
      designId,
      summary: automationResult.text,
      toolCallCount: toolCalls.length,
      hitStepLimit: automationResult.hitStepLimit,
      timeUsedMs: Date.now() - startedAt,
      toolLog: toolCalls,
      usage: toModelUsageShape(automationResult.usage),
    };
  }

  return result;
}
