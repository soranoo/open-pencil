import { runPrompt } from "@/chat-engine.js";
import { loadDocument } from "@/document.js";
import { env } from "@/env.js";
import { createSession, getSession, persistSession } from "@/session-manager.js";
import { getStorage } from "@/storage/index.js";

export interface GenerateRequest {
  prompt: string;
  designId?: string;
}

export interface GenerateResponse {
  designId: string;
  summary: string;
  toolCallCount: number;
  hitStepLimit: boolean;
  toolLog: Array<{ tool: string; mutates: boolean }>;
}

export class DesignNotFoundError extends Error {
  constructor(designId: string) {
    super(`No saved design found for ${designId}`);
    this.name = "DesignNotFoundError";
  }
}

export async function processGenerateRequest(body: GenerateRequest): Promise<GenerateResponse> {
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

  // const result = await runPrompt(
  //   session.doc,
  //   {
  //     providerID: env.AI_PROVIDER_ID,
  //     apiKey: env.AI_API_KEY,
  //     modelID: env.AI_MODEL_ID,
  //     customBaseURL: env.AI_CUSTOM_BASE_URL,
  //     customAPIType: env.AI_CUSTOM_API_TYPE,
  //   },
  //   body.prompt,
  //   session.messages,
  // );
  const result = {
    messages: [],
    toolLog: [],
    text: "dev",
    hitStepLimit: false,
  };

  session.messages = result.messages;
  await persistSession(session);

  return {
    designId: session.id,
    summary: result.text,
    toolCallCount: result.toolLog.length,
    hitStepLimit: result.hitStepLimit,
    toolLog: result.toolLog.map((entry) => ({ tool: entry.tool, mutates: entry.mutates })),
  };
}
