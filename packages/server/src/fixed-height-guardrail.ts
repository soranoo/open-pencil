import { computeAllLayouts } from "@open-pencil/core/layout";
import type { SceneGraph, SceneNode } from "@open-pencil/scene-graph";

import type { DocumentHandle } from "./document";

export interface FixedHeightGuardrailOptions {
  nodeIds?: string[];
}

function isBoardContainer(node: SceneNode): boolean {
  return node.type === "FRAME" || node.type === "COMPONENT";
}

function collectBoardContainers(graph: SceneGraph, pageId: string): SceneNode[] {
  const boards: SceneNode[] = [];

  for (const pageChild of graph.getChildren(pageId)) {
    if (pageChild.type === "SECTION") {
      for (const sectionChild of graph.getChildren(pageChild.id)) {
        if (isBoardContainer(sectionChild)) boards.push(sectionChild);
      }
    } else if (isBoardContainer(pageChild)) {
      boards.push(pageChild);
    }
  }

  return boards;
}

function getHeightSizing(node: SceneNode): SceneNode["primaryAxisSizing"] {
  if (node.layoutMode === "HORIZONTAL") return node.counterAxisSizing;
  if (node.layoutMode === "VERTICAL") return node.primaryAxisSizing;
  return "FIXED";
}

function clearDerivedHeight(node: SceneNode): Partial<SceneNode>["figmaDerivedLayout"] {
  if (!node.figmaDerivedLayout || !("height" in node.figmaDerivedLayout)) {
    return node.figmaDerivedLayout;
  }

  const derived = { ...node.figmaDerivedLayout };
  delete derived.height;
  return Object.keys(derived).length > 0 ? derived : null;
}

function getContentBottom(graph: SceneGraph, board: SceneNode): number {
  let contentBottom = 0;

  function visit(parentId: string, offsetY: number): void {
    for (const child of graph.getChildren(parentId)) {
      if (!child.visible || child.locked || child.layoutPositioning === "ABSOLUTE") continue;

      const childY = offsetY + child.y;
      contentBottom = Math.max(contentBottom, childY + child.height);
      visit(child.id, childY);
    }
  }

  visit(board.id, 0);
  return contentBottom;
}

function repairFixedHeightBoard(graph: SceneGraph, board: SceneNode): boolean {
  if (getHeightSizing(board) !== "FIXED") return false;

  const contentBottom = getContentBottom(graph, board);
  const requiredHeight = Math.ceil(contentBottom + Math.max(0, board.paddingBottom));
  if (requiredHeight <= board.height) return false;

  if (board.layoutMode === "NONE") {
    graph.updateNode(board.id, {
      height: requiredHeight,
      figmaDerivedLayout: board.figmaDerivedLayout
        ? { ...board.figmaDerivedLayout, height: requiredHeight }
        : board.figmaDerivedLayout,
    });
    return true;
  }

  graph.updateNode(board.id, {
    minHeight: Math.max(board.minHeight ?? 0, board.height),
    primaryAxisSizing: board.layoutMode === "VERTICAL" ? "HUG" : board.primaryAxisSizing,
    counterAxisSizing: board.layoutMode === "HORIZONTAL" ? "HUG" : board.counterAxisSizing,
    figmaDerivedLayout: clearDerivedHeight(board),
  });
  return true;
}

export function runFixedHeightGuardrail(
  doc: DocumentHandle,
  options: FixedHeightGuardrailOptions = {},
): string[] {
  const selectedNodeIds = options.nodeIds ? new Set(options.nodeIds) : undefined;
  const repairedBoardIds: string[] = [];

  for (const board of collectBoardContainers(doc.graph, doc.figma.currentPageId)) {
    if (selectedNodeIds && !selectedNodeIds.has(board.id)) continue;
    if (repairFixedHeightBoard(doc.graph, board)) repairedBoardIds.push(board.id);
  }

  if (repairedBoardIds.length > 0) {
    computeAllLayouts(doc.graph, doc.figma.currentPageId);
  }

  return repairedBoardIds;
}