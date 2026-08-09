import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { FigmaAPI } from '#core/figma-api'
import { defineTool } from '#core/tools/schema'

export interface AnalyzeOverflowArgs {
  page?: string
  page_id?: string
  parent_id?: string
  parent_scope?: 'children' | 'descendants'
  include_hidden?: boolean
  include_locked?: boolean
  include_absolute?: boolean
  limit?: number
}

export interface OverflowNodeSummary {
  id: string
  name: string
  type: string
  parentId: string | null
  x: number
  y: number
  width: number
  height: number
}

export interface OverflowItem {
  child: OverflowNodeSummary
  parent: OverflowNodeSummary
  overflowX: boolean
  overflowY: boolean
  widthDelta: number
  heightDelta: number
  widthRatio: number
  heightRatio: number
  message: string
  guidance: string
}

export interface AnalyzeOverflowSummary {
  totalNodes: number
  analyzedNodes: number
  overflowCount: number
  axisCounts: {
    x: number
    y: number
    both: number
  }
}

export interface AnalyzeOverflowResult {
  overflows: OverflowItem[]
  summary: AnalyzeOverflowSummary
}

function toNodeSummary(node: SceneNode): OverflowNodeSummary {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    parentId: node.parentId,
    x: Math.round(node.x),
    y: Math.round(node.y),
    width: Math.round(node.width),
    height: Math.round(node.height)
  }
}

function findPageId(graph: SceneGraph, node: SceneNode): string | null {
  let current: SceneNode | undefined = node
  while (current) {
    if (current.type === 'CANVAS') return current.id
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return null
}

function findPageIdByName(graph: SceneGraph, name: string | undefined): string | undefined {
  if (!name) return undefined
  return graph.getPages().find((page) => page.name === name)?.id
}

function isEffectivelyHidden(graph: SceneGraph, node: SceneNode): boolean {
  let current: SceneNode | undefined = node
  while (current) {
    if (!current.visible) return true
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return false
}

function isEffectivelyLocked(graph: SceneGraph, node: SceneNode): boolean {
  let current: SceneNode | undefined = node
  while (current) {
    if (current.locked) return true
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return false
}

function isCandidate(
  graph: SceneGraph,
  node: SceneNode,
  options: {
    includeHidden: boolean
    includeLocked: boolean
    includeAbsolute: boolean
    pageId?: string
  }
): boolean {
  if (node.type === 'CANVAS') return false
  if (!node.parentId) return false
  if (!options.includeHidden && isEffectivelyHidden(graph, node)) return false
  if (!options.includeLocked && isEffectivelyLocked(graph, node)) return false
  if (!options.includeAbsolute && node.layoutPositioning === 'ABSOLUTE') return false
  if (options.pageId && findPageId(graph, node) !== options.pageId) return false
  return true
}

function compareAgainstParent(child: SceneNode, parent: SceneNode): OverflowItem | null {
  if (parent.type === 'CANVAS') return null
  if (parent.width <= 0 || parent.height <= 0) return null

  const widthDelta = child.width - parent.width
  const heightDelta = child.height - parent.height
  const overflowX = widthDelta > 0
  const overflowY = heightDelta > 0

  if (!overflowX && !overflowY) return null

  const widthRatio = overflowX ? child.width / parent.width : 1
  const heightRatio = overflowY ? child.height / parent.height : 1
  const axisText = overflowX && overflowY ? 'width and height' : overflowX ? 'width' : 'height'
  const deltas: string[] = []
  if (overflowX) deltas.push(`width +${Math.round(widthDelta)}px`)
  if (overflowY) deltas.push(`height +${Math.round(heightDelta)}px`)

  return {
    child: toNodeSummary(child),
    parent: toNodeSummary(parent),
    overflowX,
    overflowY,
    widthDelta: Math.round(Math.max(0, widthDelta)),
    heightDelta: Math.round(Math.max(0, heightDelta)),
    widthRatio: Math.round(widthRatio * 1000) / 1000,
    heightRatio: Math.round(heightRatio * 1000) / 1000,
    message: `Child "${child.name}" is larger than parent "${parent.name}" on ${axisText} (${deltas.join(', ')})`,
    guidance:
      'Check whether this overflow is intentional (hero bleed, decorative art, carousel, modal) or a layout bug. If unintentional, resize the child or parent instead of relying on hidden clipping.'
  }
}

export function computeOverflowDetections(
  graph: SceneGraph,
  args: AnalyzeOverflowArgs = {}
): AnalyzeOverflowResult {
  const explicitPageId = args.page_id?.trim()
  const explicitPageName = args.page?.trim()
  const resolvedPageId =
    explicitPageId ?? findPageIdByName(graph, explicitPageName) ?? graph.getPages()[0]?.id

  if (!resolvedPageId) {
    return {
      overflows: [],
      summary: {
        totalNodes: 0,
        analyzedNodes: 0,
        overflowCount: 0,
        axisCounts: { x: 0, y: 0, both: 0 }
      }
    }
  }

  const includeHidden = args.include_hidden === true
  const includeLocked = args.include_locked === true
  const includeAbsolute = args.include_absolute === true
  const parentIdFilter = args.parent_id?.trim()
  const parentScope = args.parent_scope ?? 'children'

  let totalNodes = 0
  let analyzedNodes = 0
  const overflows: OverflowItem[] = []

  for (const node of graph.getAllNodes()) {
    if (node.type === 'CANVAS') continue
    if (findPageId(graph, node) !== resolvedPageId) continue

    if (parentIdFilter) {
      const inScope =
        parentScope === 'descendants'
          ? node.id !== parentIdFilter && graph.isDescendant(node.id, parentIdFilter)
          : node.parentId === parentIdFilter
      if (!inScope) continue
    }

    totalNodes++

    if (
      !isCandidate(graph, node, {
        includeHidden,
        includeLocked,
        includeAbsolute,
        pageId: resolvedPageId
      })
    ) {
      continue
    }

    analyzedNodes++

    const parent = node.parentId ? graph.getNode(node.parentId) : undefined
    if (!parent) continue

    const overflow = compareAgainstParent(node, parent)
    if (overflow) overflows.push(overflow)
  }

  overflows.sort((a, b) => {
    const aMax = Math.max(a.widthDelta, a.heightDelta)
    const bMax = Math.max(b.widthDelta, b.heightDelta)
    return bMax - aMax
  })

  const limit = Math.max(0, Number.isFinite(Number(args.limit)) ? Number(args.limit) : 100)
  const axisCounts = { x: 0, y: 0, both: 0 }
  for (const item of overflows) {
    if (item.overflowX && item.overflowY) axisCounts.both++
    else if (item.overflowX) axisCounts.x++
    else if (item.overflowY) axisCounts.y++
  }

  return {
    overflows: overflows.slice(0, limit),
    summary: {
      totalNodes,
      analyzedNodes,
      overflowCount: overflows.length,
      axisCounts
    }
  }
}

export const analyzeOverflow = defineTool({
  name: 'analyze_overflow',
  description:
    'Detect children that are larger than their direct parent in width or height. Use this before finishing a board to catch likely layout bugs, then decide whether each overflow is intentional or by design.',
  params: {
    page: {
      type: 'string',
      description: 'Limit analysis to nodes on the named page'
    },
    page_id: {
      type: 'string',
      description: 'Limit analysis to nodes on the page with this stable ID'
    },
    parent_id: {
      type: 'string',
      description:
        'Limit analysis to nodes under this parent/container. Useful when checking one board or section during generation.'
    },
    parent_scope: {
      type: 'string',
      description:
        'Only used when parent_id is set. "children" checks direct children, "descendants" checks the full subtree.',
      enum: ['children', 'descendants'],
      default: 'children'
    },
    include_hidden: {
      type: 'boolean',
      description: 'Include hidden nodes in the analysis'
    },
    include_locked: {
      type: 'boolean',
      description: 'Include locked nodes in the analysis'
    },
    include_absolute: {
      type: 'boolean',
      description: 'Include absolutely-positioned nodes in the analysis'
    },
    limit: {
      type: 'number',
      description: 'Maximum overflow findings to return (default: 100)',
      default: 100
    }
  },
  execute: (figma: FigmaAPI, args) => {
    const page_id = args.page_id ?? (args.page ? undefined : figma.currentPageId)
    return computeOverflowDetections(figma.graph, {
      ...(args as AnalyzeOverflowArgs),
      page_id
    })
  }
})
