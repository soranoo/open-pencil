import { computeAllLayouts } from "@open-pencil/core/layout";
import { computeOverflowDetections } from "@open-pencil/core/tools";
import type { SceneGraph, SceneNode } from "@open-pencil/scene-graph";

import type { DocumentHandle } from "./document";

export interface OverflowGuardrailOptions {
  nodeIds?: string[];
}

function getPositionRelativeToAncestor(
  graph: SceneGraph,
  node: SceneNode,
  ancestor: SceneNode,
): { x: number; y: number } | null {
  let current = node.parentId ? graph.getNode(node.parentId) : undefined;
  let x = node.x;
  let y = node.y;

  while (current && current.id !== ancestor.id) {
    x += current.x;
    y += current.y;
    current = current.parentId ? graph.getNode(current.parentId) : undefined;
  }

  return current?.id === ancestor.id ? { x, y } : null;
}

function getTrailingPaddingToAncestor(
  graph: SceneGraph,
  node: SceneNode,
  ancestor: SceneNode,
): number | null {
  let current = node.parentId ? graph.getNode(node.parentId) : undefined;
  let padding = 0;

  while (current && current.id !== ancestor.id) {
    padding += Math.max(0, current.paddingRight);
    current = current.parentId ? graph.getNode(current.parentId) : undefined;
  }

  if (current?.id !== ancestor.id) return null;
  return padding + Math.max(0, ancestor.paddingRight);
}

function fitTextToParent(graph: SceneGraph, child: SceneNode, parent: SceneNode): boolean {
  const paddingLeft = Math.max(0, parent.paddingLeft);
  const position = getPositionRelativeToAncestor(graph, child, parent);
  const trailingPadding = getTrailingPaddingToAncestor(graph, child, parent);
  if (!position || trailingPadding === null) return false;

  const minX = paddingLeft;
  const maxX = Math.max(minX, parent.width - trailingPadding - 1);
  const targetX = Math.min(Math.max(position.x, minX), maxX);
  const x = child.x + targetX - position.x;
  const availableWidth = Math.max(1, parent.width - targetX - trailingPadding);
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