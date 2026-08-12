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
import {
  CORE_TOOLS,
  EXTENDED_TOOLS,
  KvPlanStore,
  defineTool,
  setPlanStore,
  toolsToAI,
} from "@open-pencil/core/tools";
import type { ToolLogEntry } from "@open-pencil/core/tools";
import { tool, type ToolSet } from "ai";
import * as v from "valibot";

import { runFixedHeightGuardrail } from "./fixed-height-guardrail.js";
import { runOverflowGuardrail } from "./overflow-guardrail.js";
import { runOverlapGuardrail } from "./overlap-guardrail.js";
import { getKvStore } from "@/kv/index.js";

export const MAX_AGENT_STEPS = 50;

export interface RunState {
  toolLog: ToolLogEntry[];
  currentSteps: number;
}

interface AgentLogContext {
  requestId?: string;
  designId?: string;
}

const fixFixedHeightTool = defineTool({
  name: "fix_fixed_height",
  description:
    "Expand fixed-height boards so they can fit their content before finalizing. Use this when a board is too short for its children.",
  mutates: true,
  params: {
    node_ids: {
      type: "string[]",
      description: "Optional list of board node IDs to repair; if omitted, all boards on the page are checked.",
    },
  },
  execute: (figma, args) => {
    const doc = { graph: figma.graph, figma };
    return runFixedHeightGuardrail(doc, { nodeIds: args.node_ids });
  },
});

const fixOverlapTool = defineTool({
  name: "fix_overlap",
  description:
    "Resolve overlapping children by auto-stacking or reflowing them before finalizing a board.",
  mutates: true,
  params: {},
  execute: async (figma) => {
    const doc = { graph: figma.graph, figma };
    return await runOverlapGuardrail(doc);
  },
});

const fixOverflowTool = defineTool({
  name: "fix_overflow",
  description:
    "Shrink or reflow text nodes that overflow their parent so the board remains stable before finalizing.",
  mutates: true,
  params: {
    node_ids: {
      type: "string[]",
      description: "Optional list of text node IDs to repair; if omitted, all overflowing text nodes are checked.",
    },
  },
  execute: (figma, args) => {
    const doc = { graph: figma.graph, figma };
    return runOverflowGuardrail(doc, { nodeIds: args.node_ids });
  },
});

const HEADLESS_TOOLS = [
  ...CORE_TOOLS,
  ...EXTENDED_TOOLS.filter((tool) =>
    ["analyze_overflow", "arrange", "arrange_rows"].includes(tool.name),
  ),
  fixFixedHeightTool,
  fixOverlapTool,
  fixOverflowTool,
  // createPlanTask,
  // createPlanTasks,
];

export function createRunState(): RunState {
  return { toolLog: [], currentSteps: 0 };
}

/**
 * Builds the same tool set the in-app chat exposes to the model, bound to a headless
 * FigmaAPI instance instead of a live editor store.
 */
export function createHeadlessTools(
  figma: FigmaAPI,
  runState: RunState,
  logContext: AgentLogContext = {},
): ToolSet {
  // Plan tools default to an in-process MemoryPlanStore (see @open-pencil/core/tools).
  // Swap in the KV-backed store so the plan survives across requests/replicas,
  // scoped to this document (or the request, if the design hasn't been saved yet).
  const planNamespace = logContext.designId ?? logContext.requestId ?? "default";
  setPlanStore(new KvPlanStore(getKvStore(), planNamespace));

  return toolsToAI(
    HEADLESS_TOOLS,
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
        if (entry.error) {
          console.error("[agent-tool] execution failed", {
            requestId: logContext.requestId ?? null,
            designId: logContext.designId ?? null,
            tool: entry.tool,
            args: entry.args,
            error: entry.error,
          });
        }
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
