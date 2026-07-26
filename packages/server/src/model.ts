// Adapted from: src/app/ai/chat/model.ts (upstream)
// Change from upstream: dropped `desktopFetch()` (Tauri-only) — the fn always returned
// `undefined` outside the desktop app anyway, which just falls back to global fetch.
// Everything else is unchanged: same provider factories, same switch structure.

import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import type { AIProviderID } from "@open-pencil/core";

export type ModelConfig = {
  providerID: AIProviderID;
  apiKey: string;
  modelID: string;
  customBaseURL?: string;
  customAPIType?: "completions" | "responses";
};

export function resolveLanguageModelID(
  config: Pick<ModelConfig, "modelID">,
) {
  return config.modelID.trim();
}

export function createLanguageModel(config: ModelConfig): LanguageModel {
  const effectiveModelID = resolveLanguageModelID(config);

  switch (config.providerID) {
    case "openrouter": {
      const openrouter = createOpenRouter({
        apiKey: config.apiKey,
        headers: {
          "X-OpenRouter-Title": "OpenPencil (headless server)",
          "HTTP-Referer": "https://github.com/open-pencil/open-pencil",
        },
      });
      return openrouter(effectiveModelID);
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey: config.apiKey });
      return anthropic(effectiveModelID);
    }
    case "openai": {
      const openai = createOpenAI({ apiKey: config.apiKey });
      return openai(effectiveModelID);
    }
    case "google": {
      const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
      return google(effectiveModelID);
    }
    case "deepseek": {
      const deepseek = createDeepSeek({ apiKey: config.apiKey });
      return deepseek(effectiveModelID);
    }
    case "zai": {
      const zai = createAnthropic({
        apiKey: config.apiKey,
        baseURL: "https://api.z.ai/api/anthropic",
      });
      return zai(effectiveModelID);
    }
    case "minimax": {
      const minimax = createOpenAI({
        apiKey: config.apiKey,
        baseURL: "https://api.minimax.io/v1",
      });
      return minimax.chat(effectiveModelID);
    }
    case "openai-compatible": {
      const custom = createOpenAI({ apiKey: config.apiKey, baseURL: config.customBaseURL });
      return config.customAPIType === "responses"
        ? custom.responses(effectiveModelID)
        : custom.chat(effectiveModelID);
    }
    case "anthropic-compatible": {
      const custom = createAnthropic({ apiKey: config.apiKey, baseURL: config.customBaseURL });
      return custom(effectiveModelID);
    }
    default: {
      throw new Error(`Unknown provider: ${config.providerID}`);
    }
  }
}
