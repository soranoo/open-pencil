// Adapted from: src/app/ai/tools/index.ts (upstream)
//
// What changed vs. upstream's createAITools(store):
//   - getFigma: () => makeFigmaFromStore(store)   -->   getFigma: () => figma  (direct)
//   - onAfterExecute dropped: ensureGraphFonts(..., store.renderer) — no live renderer to
//     hand it (see open item in the spec doc: verify headless text-metric parity via
//     @open-pencil/core/io's headlessRenderNodes/initCanvasKit before trusting typography
//     heavy prompts 1:1 against the in-app result)
//   - onAfterExecute dropped: store.requestRender() — nothing is rendering
//   - onAfterExecute dropped: store.pushUndoEntry() — no undo stack server-side; the tool
//     log below is the audit trail instead
//   - onFlashNodes dropped: store.aiFlashDone() — no canvas to flash
//   - layout recompute kept: computeAllLayouts(graph, pageId) is core, no DOM dependency
//
// Everything else — CORE_TOOLS, toolsToAI, the valibot/tool adapter wiring — is used exactly
// as upstream uses it, since that part was already framework-agnostic.

import { valibotSchema } from "@ai-sdk/valibot";
import type { FigmaAPI } from "@open-pencil/core/figma-api";
import { computeAllLayouts } from "@open-pencil/core/layout";
import { CORE_TOOLS, toolsToAI } from "@open-pencil/core/tools";
import type { ToolLogEntry } from "@open-pencil/core/tools";
import { tool } from "ai";
import * as v from "valibot";

export const MAX_AGENT_STEPS = 50;

export interface RunState {
  toolLog: ToolLogEntry[];
  currentSteps: number;
}

export function createRunState(): RunState {
  return { toolLog: [], currentSteps: 0 };
}

/**
 * Builds the same tool set the in-app chat exposes to the model, bound to a headless
 * FigmaAPI instance instead of a live editor store.
 */
export function createHeadlessTools(figma: FigmaAPI, runState: RunState) {
  return toolsToAI(
    CORE_TOOLS,
    {
      getFigma: () => figma,
      onBeforeExecute: () => {
        // No undo snapshot needed headlessly — nothing to roll back to in a UI sense.
        // If you want per-tool-call rollback for retries, snapshot `figma.graph` here
        // with structuredClone and restore it in a catch block in chat-engine.ts.
      },
      onAfterExecute: (def) => {
        if (def.mutates) {
          computeAllLayouts(figma.graph, figma.currentPageId);
        }
      },
      onFlashNodes: () => {
        // No canvas to highlight. No-op.
      },
      onToolLog: (entry) => {
        runState.toolLog.push(entry);
        runState.currentSteps++;
      },
      getStepBudget: () => ({ current: runState.currentSteps, max: MAX_AGENT_STEPS }),
    },
    // NOTE: @open-pencil/core's published .d.ts references its own internal, bundled
    // copies of `ai`/`valibot`/`@ai-sdk/valibot` (visible as nested node_modules/.bun/...
    // paths if you inspect dist/tools/ai-adapter.d.ts) rather than declaring them as
    // peerDependencies. Independently-installed copies of these packages are structurally
    // compatible at runtime but TypeScript treats them as distinct nominal types, which
    // trips strict checking here. The cast is a pragmatic workaround for that packaging
    // gap — worth raising upstream — not a sign the wiring itself is wrong.
    { v, valibotSchema, tool } as unknown as Parameters<typeof toolsToAI>[2],
  );
}
