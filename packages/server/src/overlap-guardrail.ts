import { SECTION_DEFAULT_STROKE } from "@open-pencil/core/constants";
import { computeAllLayouts } from "@open-pencil/core/layout";
import { computeOverlaps } from "@open-pencil/core/tools";
import type { OverlapItem } from "@open-pencil/core/tools";
import type { SceneGraph, SceneNode, Stroke } from "@open-pencil/scene-graph";

import type { DocumentHandle } from "./document";

const DEFAULT_SECTION_GAP = 48;
const DEFAULT_CHILD_GAP = 16;
const DEFAULT_CHILD_PADDING = 16;
const SECTION_FIT_PADDING = 24;

const SECTION_STROKE: Stroke = {
  color: { ...SECTION_DEFAULT_STROKE.color },
  weight: 12,
  opacity: SECTION_DEFAULT_STROKE.opacity,
  visible: SECTION_DEFAULT_STROKE.visible,
  align: SECTION_DEFAULT_STROKE.align,
};

type RepairTarget = {
  parentId: string;
  childIds: string[];
  mode: "canvas-stack" | "auto-layout" | "manual-stack";
  axis: "HORIZONTAL" | "VERTICAL";
  gap: number;
  padding: number;
};

function cloneSectionStroke(): Stroke {
  return {
    color: { ...SECTION_STROKE.color },
    weight: SECTION_STROKE.weight,
    opacity: SECTION_STROKE.opacity,
    visible: SECTION_STROKE.visible,
    align: SECTION_STROKE.align,
  };
}

function isContainerNode(node: SceneNode): boolean {
  return (
    node.type === "FRAME" ||
    node.type === "SECTION" ||
    node.type === "COMPONENT" ||
    node.type === "INSTANCE"
  );
}

function isAutoLayoutCandidate(node: SceneNode): boolean {
  return (
    (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "INSTANCE") &&
    node.childIds.length > 1
  );
}

function overlapSet(overlaps: OverlapItem[]): Set<string> {
  const ids = new Set<string>();
  for (const overlap of overlaps) {
    ids.add(overlap.nodeA.id);
    ids.add(overlap.nodeB.id);
  }
  return ids;
}

function collectChildren(graph: SceneGraph, parentId: string): SceneNode[] {
  return graph
    .getChildren(parentId)
    .filter((node) => node.visible && !node.locked && node.layoutPositioning !== "ABSOLUTE");
}

function computeAxis(children: SceneNode[]): "HORIZONTAL" | "VERTICAL" {
  if (children.length < 2) return "VERTICAL";
  let totalDx = 0;
  let totalDy = 0;
  for (let i = 1; i < children.length; i++) {
    totalDx += Math.abs(children[i].x - children[i - 1].x);
    totalDy += Math.abs(children[i].y - children[i - 1].y);
  }
  return totalDx > totalDy ? "HORIZONTAL" : "VERTICAL";
}

function sortChildren(children: SceneNode[], axis: "HORIZONTAL" | "VERTICAL"): SceneNode[] {
  return [...children].sort((a, b) => {
    if (axis === "HORIZONTAL") {
      if (a.x !== b.x) return a.x - b.x;
      return a.y - b.y;
    }
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });
}

function computeGap(
  children: SceneNode[],
  axis: "HORIZONTAL" | "VERTICAL",
  fallback: number,
): number {
  if (children.length < 2) return fallback;
  const sorted = sortChildren(children, axis);
  let minGap = Number.POSITIVE_INFINITY;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const next = sorted[i];
    const gap =
      axis === "HORIZONTAL" ? next.x - (prev.x + prev.width) : next.y - (prev.y + prev.height);
    if (gap >= 0) {
      minGap = Math.min(minGap, gap);
    }
  }
  if (!Number.isFinite(minGap)) return fallback;
  return Math.max(fallback, Math.round(minGap));
}

function applyAutoLayoutRepair(graph: SceneGraph, target: RepairTarget): boolean {
  const parent = graph.getNode(target.parentId);
  if (!parent || !isAutoLayoutCandidate(parent)) return false;

  const children = target.childIds
    .map((id) => graph.getNode(id))
    .filter((node): node is SceneNode => node !== undefined);
  if (children.length < 2) return false;

  const ordered = sortChildren(children, target.axis);
  graph.updateNode(parent.id, {
    layoutMode: target.axis,
    primaryAxisSizing: parent.primaryAxisSizing === "FILL" ? "FILL" : "HUG",
    counterAxisSizing: parent.counterAxisSizing === "FILL" ? "FILL" : "HUG",
    itemSpacing: target.gap,
    paddingTop: target.padding,
    paddingRight: target.padding,
    paddingBottom: target.padding,
    paddingLeft: target.padding,
  });

  for (let index = 0; index < ordered.length; index++) {
    const child = ordered[index];
    graph.reorderChild(child.id, parent.id, index);
    graph.updateNode(child.id, {
      layoutPositioning: "AUTO",
    });
  }

  return true;
}

function applyCanvasStackRepair(graph: SceneGraph, target: RepairTarget): boolean {
  const parent = graph.getNode(target.parentId);
  if (!parent || parent.type !== "CANVAS") return false;

  const children = target.childIds
    .map((id) => graph.getNode(id))
    .filter((node): node is SceneNode => node !== undefined);
  if (children.length < 2) return false;

  const ordered = sortChildren(children, target.axis);
  const startX = Math.min(...ordered.map((child) => child.x));
  const startY = Math.min(...ordered.map((child) => child.y));
  let cursorX = startX;
  let cursorY = startY;

  for (const child of ordered) {
    graph.updateNode(child.id, {
      x: cursorX,
      y: cursorY,
      layoutPositioning: "AUTO",
    });
    if (target.axis === "HORIZONTAL") {
      cursorX += child.width + target.gap;
    } else {
      cursorY += child.height + target.gap;
    }
  }

  return true;
}

function applyManualStackRepair(graph: SceneGraph, target: RepairTarget): boolean {
  const parent = graph.getNode(target.parentId);
  if (!parent || !isContainerNode(parent) || parent.type === "CANVAS") return false;

  const children = target.childIds
    .map((id) => graph.getNode(id))
    .filter((node): node is SceneNode => node !== undefined);
  if (children.length < 2) return false;

  const ordered = sortChildren(children, target.axis);
  let cursorX = target.padding;
  let cursorY = target.padding;
  let contentWidth = 0;
  let contentHeight = 0;

  for (const child of ordered) {
    graph.updateNode(child.id, {
      x: cursorX,
      y: cursorY,
      layoutPositioning: "AUTO",
    });

    if (target.axis === "HORIZONTAL") {
      cursorX += child.width + target.gap;
      contentWidth = cursorX - target.gap + target.padding;
      contentHeight = Math.max(contentHeight, child.height + target.padding * 2);
    } else {
      cursorY += child.height + target.gap;
      contentHeight = cursorY - target.gap + target.padding;
      contentWidth = Math.max(contentWidth, child.width + target.padding * 2);
    }
  }

  graph.updateNode(parent.id, {
    width: Math.max(parent.width, contentWidth),
    height: Math.max(parent.height, contentHeight),
  });

  return true;
}

function buildRepairTarget(
  graph: SceneGraph,
  parentId: string,
  fallbackGap: number,
  fallbackPadding: number,
): RepairTarget | null {
  const parent = graph.getNode(parentId);
  if (!parent || !isContainerNode(parent) || parent.childIds.length < 2) return null;
  const children = collectChildren(graph, parentId);
  if (children.length < 2) return null;
  const axis = computeAxis(children);
  return {
    parentId,
    childIds: children.map((child) => child.id),
    mode: isAutoLayoutCandidate(parent) ? "auto-layout" : "manual-stack",
    axis,
    gap: computeGap(children, axis, fallbackGap),
    padding: Math.max(
      fallbackPadding,
      parent.paddingTop,
      parent.paddingRight,
      parent.paddingBottom,
      parent.paddingLeft,
    ),
  };
}

function collectRepairTargets(graph: SceneGraph, pageId: string): RepairTarget[] {
  const targets = new Map<string, RepairTarget>();
  const topLevelOverlaps = computeOverlaps(graph, {
    page_id: pageId,
    scope: "top-level",
    category: "sibling-overlap",
    include_absolute: true,
    limit: 500,
  });
  const topLevelIds = overlapSet(topLevelOverlaps.overlaps);
  if (topLevelIds.size > 0) {
    const pageChildren = collectChildren(graph, pageId).filter((child) =>
      topLevelIds.has(child.id),
    );
    if (pageChildren.length > 1) {
      const axis = computeAxis(pageChildren);
      targets.set(pageId, {
        parentId: pageId,
        childIds: pageChildren.map((child) => child.id),
        mode: "canvas-stack",
        axis,
        gap: computeGap(pageChildren, axis, DEFAULT_SECTION_GAP),
        padding: 0,
      });
    }
  }

  for (const child of graph.getChildren(pageId)) {
    if (!isContainerNode(child) || child.childIds.length < 2) continue;
    const result = computeOverlaps(graph, {
      page_id: pageId,
      parent_id: child.id,
      parent_scope: "children",
      scope: "same-parent",
      category: "sibling-overlap",
      include_absolute: true,
      limit: 500,
    });
    if (result.summary.overlapCount === 0) continue;
    const target = buildRepairTarget(graph, child.id, DEFAULT_CHILD_GAP, DEFAULT_CHILD_PADDING);
    if (target) targets.set(child.id, target);
  }

  return [...targets.values()];
}

function fitSectionToChildren(graph: SceneGraph, section: SceneNode): boolean {
  if (section.type !== "SECTION") return false;
  const children = graph.getChildren(section.id).filter((child) => child.visible && !child.locked);
  if (children.length === 0) {
    graph.updateNode(section.id, {
      fills: [],
      strokes: [cloneSectionStroke()],
      borderTopWeight: 12,
      borderRightWeight: 12,
      borderBottomWeight: 12,
      borderLeftWeight: 12,
      independentStrokeWeights: false,
    });
    return true;
  }

  const minX = Math.min(...children.map((child) => child.x));
  const minY = Math.min(...children.map((child) => child.y));
  const maxX = Math.max(...children.map((child) => child.x + child.width));
  const maxY = Math.max(...children.map((child) => child.y + child.height));

  if (minX !== SECTION_FIT_PADDING || minY !== SECTION_FIT_PADDING) {
    for (const child of children) {
      graph.updateNode(child.id, {
        x: child.x - minX + SECTION_FIT_PADDING,
        y: child.y - minY + SECTION_FIT_PADDING,
      });
    }
  }

  graph.updateNode(section.id, {
    width: maxX - minX + SECTION_FIT_PADDING * 2,
    height: maxY - minY + SECTION_FIT_PADDING * 2,
    fills: [],
    strokes: [cloneSectionStroke()],
    borderTopWeight: 12,
    borderRightWeight: 12,
    borderBottomWeight: 12,
    borderLeftWeight: 12,
    independentStrokeWeights: false,
  });

  return true;
}

function fitAllSections(graph: SceneGraph, pageId: string): string[] {
  const repaired: string[] = [];
  for (const child of graph.getChildren(pageId)) {
    if (child.type !== "SECTION") continue;
    if (fitSectionToChildren(graph, child)) {
      repaired.push(child.id);
    }
  }
  return repaired;
}

export async function runOverlapGuardrail(doc: DocumentHandle): Promise<string[]> {
  const pageId = doc.figma.currentPageId;
  const repairedParents: string[] = [];
  const targets = collectRepairTargets(doc.graph, pageId);

  for (const target of targets) {
    const changed =
      target.mode === "canvas-stack"
        ? applyCanvasStackRepair(doc.graph, target)
        : target.mode === "auto-layout"
          ? applyAutoLayoutRepair(doc.graph, target)
          : applyManualStackRepair(doc.graph, target);
    if (changed) {
      repairedParents.push(target.parentId);
    }
  }

  const fittedSections = fitAllSections(doc.graph, pageId);
  for (const sectionId of fittedSections) {
    if (!repairedParents.includes(sectionId)) {
      repairedParents.push(sectionId);
    }
  }

  if (repairedParents.length > 0) {
    computeAllLayouts(doc.graph, pageId);
  }

  return repairedParents;
}
