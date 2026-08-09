import { computeAllLayouts } from "@open-pencil/core/layout";
import { computeOverflowDetections } from "@open-pencil/core/tools";
import type { SceneGraph, SceneNode } from "@open-pencil/scene-graph";

import type { DocumentHandle } from "./document";

export interface OverflowGuardrailOptions {
  nodeIds?: string[];
}

function fitTextToParent(graph: SceneGraph, child: SceneNode, parent: SceneNode): boolean {
  const paddingLeft = Math.max(0, parent.paddingLeft);
  const paddingRight = Math.max(0, parent.paddingRight);
  const minX = paddingLeft;
  const maxX = Math.max(minX, parent.width - paddingRight - 1);
  const x = Math.min(Math.max(child.x, minX), maxX);
  const availableWidth = Math.max(1, parent.width - x - paddingRight);
  const width = Math.min(child.width, availableWidth);

  if (x === child.x && width === child.width && child.textAutoResize === "HEIGHT") {
    return false;
  }

  graph.updateNode(child.id, {
    x,
    width,
    textAutoResize: "HEIGHT",
    figmaDerivedLayout: child.figmaDerivedLayout
      ? { ...child.figmaDerivedLayout, x, width }
      : child.figmaDerivedLayout,
  });
  return true;
}

// Only affects text nodes that are overflowing their parent
export function runOverflowGuardrail(
  doc: DocumentHandle,
  options: OverflowGuardrailOptions = {},
): string[] {
  const selectedNodeIds = options.nodeIds ? new Set(options.nodeIds) : undefined;
  const result = computeOverflowDetections(doc.graph, {
    page_id: doc.figma.currentPageId,
    include_absolute: true,
    limit: 500,
  });
  const repairedNodeIds: string[] = [];

  for (const group of result.groups) {
    for (const overflow of group.overflows) {
      if (overflow.child.type !== "TEXT") continue;
      if (selectedNodeIds && !selectedNodeIds.has(overflow.child.id)) continue;

      const child = doc.graph.getNode(overflow.child.id);
      const parent = doc.graph.getNode(group.parent.id);
      if (!child || !parent) continue;

      if (fitTextToParent(doc.graph, child, parent)) {
        repairedNodeIds.push(child.id);
      }
    }
  }

  if (repairedNodeIds.length > 0) {
    computeAllLayouts(doc.graph, doc.figma.currentPageId);
  }

  return repairedNodeIds;
}