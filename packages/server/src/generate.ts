import type { LanguageModelUsage } from "ai";
import z from "zod";

import { runPrompt } from "@/chat-engine.js";
import { loadDocument } from "@/document.js";
import { env } from "@/env.js";
import { runOverflowGuardrail } from "@/overflow-guardrail.js";
import { runOverlapGuardrail } from "@/overlap-guardrail.js";
import { createSession, getSession, persistSession } from "@/session-manager.js";
import { getStorage } from "@/storage/index.js";

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

export async function processGenerateRequest(
  body: GenerateRequest,
  logContext?: GenerateLogContext,
): Promise<GenerateResponse> {
  let session = body.designId ? await getSession(body.designId) : undefined;
  if (!session && body.designId) {
    const bytes = await getStorage()
      .get(body.designId)
      .catch(() => null);
    if (!bytes) {
      throw new DesignNotFoundError(body.designId);
    }
    const doc = await loadDocument(bytes);
    session = await createSession(doc, body.designId);
  }
  if (!session) {
    session = await createSession();
  }

  const stubResult = {
    messages: [],
    toolLog: [],
    text: "dev",
    hitStepLimit: false,
    usage: {} as LanguageModelUsage,
  };

  const result = env.USE_AI_STUB
    ? stubResult
    : await runPrompt(
        session.doc,
        {
          providerID: env.AI_PROVIDER_ID,
          apiKey: env.AI_API_KEY,
          modelID: env.AI_MODEL_ID,
          customBaseURL: env.AI_CUSTOM_BASE_URL,
          customAPIType: env.AI_CUSTOM_API_TYPE,
        },
        body.prompt,
        session.messages,
        {
          requestId: logContext?.requestId,
          designId: session.id,
        },
      );

  const repairedOverlapNodeIds = await runOverlapGuardrail(session.doc);
  console.log(`[agent] repaired ${repairedOverlapNodeIds.length} overlapping nodes`, {
    repairedOverlapNodeIds,
    requestId: logContext?.requestId ?? null,
    designId: session.id,
  });
  const repairedOverflowNodeIds = runOverflowGuardrail(session.doc);
  console.log(`[agent] repaired ${repairedOverflowNodeIds.length} overflowing text nodes`, {
    repairedOverflowNodeIds,
    requestId: logContext?.requestId ?? null,
    designId: session.id,
  });

  session.messages = result.messages;
  session.savedAt = null;
  await persistSession(session);

  return {
    designId: session.id,
    summary: result.text,
    toolCallCount: result.toolLog.length,
    hitStepLimit: result.hitStepLimit,
    toolLog: result.toolLog.map((entry) => ({ tool: entry.tool, mutates: entry.mutates })),
    usage: result.usage,
  };
}
