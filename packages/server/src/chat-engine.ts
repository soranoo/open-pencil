// Adapted from: src/app/ai/chat/transports.ts (upstream)
//
// What changed vs. upstream's createToolLoopTransport():
//   - Dropped DirectChatTransport + @ai-sdk/vue's Chat wrapper entirely — those exist only
//     to give the Vue chat panel reactive streaming message state. A server has no UI to
//     stream into by default, so we call ToolLoopAgent.generate() directly and return the
//     result. (Swap to agent.stream() in routes/generate.ts if you want to relay progress
//     to the caller over SSE — the agent object itself doesn't change.)
//   - tools now comes from ./headless-tools.ts instead of createAITools(store)
//   - system prompt is read from disk with fs.readFileSync instead of Vite's `?raw` import
//     (see system-prompt.md in this same directory — copy it from upstream, see README.md)
//
// Kept identical to upstream: MAX_AGENT_STEPS via stepCountIs, the Anthropic prompt-caching
// provider option, and the model resolution logic.

import type { AIProviderID } from "@open-pencil/core";
import { ToolLoopAgent, stepCountIs } from "ai";
import type { LanguageModelUsage, ModelMessage } from "ai";

import type { DocumentHandle } from "./document";
import { createHeadlessTools, createRunState, MAX_AGENT_STEPS } from "./headless-tools";
import type { RunState } from "./headless-tools";
import { createLanguageModel, resolveLanguageModelID } from "./model";
import type { ModelConfig } from "./model";
import { runOverlapGuardrail } from "./overlap-guardrail";
import SYSTEM_PROMPT from "./system-prompt.md";

const ANTHROPIC_CACHE_CONTROL = {
  anthropic: { cacheControl: { type: "ephemeral" } },
} as const;

function supportsAnthropicCaching(providerID: AIProviderID, modelID: string): boolean {
  return (
    providerID === "anthropic" ||
    providerID === "anthropic-compatible" ||
    (providerID === "openrouter" && modelID.startsWith("anthropic/"))
  );
}

export interface GenerateResult {
  messages: ModelMessage[];
  toolLog: RunState["toolLog"];
  text: string;
  hitStepLimit: boolean;
  usage: LanguageModelUsage;
}

/**
 * Runs one prompt turn against a document, mutating `doc.graph` in place via the tool
 * calls the model makes. Pass back `previousMessages` on follow-up calls for multi-turn
 * refinement within the same session.
 */
export async function runPrompt(
  doc: DocumentHandle,
  modelConfig: ModelConfig,
  prompt: string,
  previousMessages: ModelMessage[] = [],
): Promise<GenerateResult> {
  const runState = createRunState();
  const tools = createHeadlessTools(doc.figma, runState);
  const effectiveModelID = resolveLanguageModelID(modelConfig);
  const cacheProviderOptions = supportsAnthropicCaching(modelConfig.providerID, effectiveModelID)
    ? ANTHROPIC_CACHE_CONTROL
    : undefined;

  const agent = new ToolLoopAgent({
    model: createLanguageModel(modelConfig),
    instructions: SYSTEM_PROMPT,
    tools,
    stopWhen: stepCountIs(MAX_AGENT_STEPS),
    providerOptions: cacheProviderOptions,
    onFinish: async () => {
      await runOverlapGuardrail(doc);
    },
  });

  const result = await agent.generate({
    messages: [...previousMessages, { role: "user", content: prompt }],
  });

  return {
    messages: [...previousMessages, { role: "user", content: prompt }, ...result.response.messages],
    toolLog: runState.toolLog,
    text: result.text,
    hitStepLimit: runState.currentSteps >= MAX_AGENT_STEPS,
    usage: result.usage,
  };
}
