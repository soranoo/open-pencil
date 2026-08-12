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
  overflowX: boolean
  overflowY: boolean
  widthDelta: number
  heightDelta: number
  widthRatio: number
  heightRatio: number
  message: string
}

export interface OverflowGroup {
  parent: OverflowNodeSummary
  parentPath: string
  overflows: OverflowItem[]
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
  groups: OverflowGroup[]
  guidance?: string
  summary: AnalyzeOverflowSummary
}

interface DetectedOverflow {
  item: OverflowItem
  parentId: string
}

const OVERFLOW_GUIDANCE =
  'Check whether this overflow is intentional (hero bleed, decorative art, carousel, modal) or a layout bug. If unintentional, resize the child or parent instead of relying on hidden clipping.'

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

function relativeAncestorPath(graph: SceneGraph, node: SceneNode): string {
  const ancestors: string[] = []
  let current = node.parentId ? graph.getNode(node.parentId) : undefined

  while (current && current.type !== 'CANVAS') {
    ancestors.unshift(`"${current.name}"[id: ${current.id}]`)
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }

  return ancestors.join('/')
}

function compareAgainstParent(
  child: SceneNode,
  parent: SceneNode
): OverflowItem | null {
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
    overflowX,
    overflowY,
    widthDelta: Math.round(Math.max(0, widthDelta)),
    heightDelta: Math.round(Math.max(0, heightDelta)),
    widthRatio: Math.round(widthRatio * 1000) / 1000,
    heightRatio: Math.round(heightRatio * 1000) / 1000,
    message: `Child "${child.name}" (id: ${child.id}) is larger on ${axisText} (${deltas.join(', ')})`
  }
}

function getPositionRelativeToAncestor(
  graph: SceneGraph,
  node: SceneNode,
  ancestor: SceneNode
): { x: number; y: number } | null {
  let current = node.parentId ? graph.getNode(node.parentId) : undefined
  let x = node.x
  let y = node.y

  while (current && current.id !== ancestor.id) {
    x += current.x
    y += current.y
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }

  return current?.id === ancestor.id ? { x, y } : null
}

function compareTextAgainstAncestor(
  graph: SceneGraph,
  child: SceneNode,
  ancestor: SceneNode
): OverflowItem | null {
  if (ancestor.type === 'CANVAS' || ancestor.width <= 0 || ancestor.height <= 0) {
    return null
  }

  const position = getPositionRelativeToAncestor(graph, child, ancestor)
  if (!position) return null

  const availableWidth = ancestor.width - position.x
  const widthDelta = child.width - availableWidth
  const overflowX = widthDelta > 0

  if (!overflowX) return null

  const widthRatio = child.width / Math.max(1, availableWidth)
  const heightRatio = 1
  const axisText = 'width'
  const deltas: string[] = []
  deltas.push(`width +${Math.round(widthDelta)}px`)

  return {
    child: toNodeSummary(child),
    overflowX,
    overflowY: false,
    widthDelta: Math.round(Math.max(0, widthDelta)),
    heightDelta: 0,
    widthRatio: Math.round(widthRatio * 1000) / 1000,
    heightRatio: Math.round(heightRatio * 1000) / 1000,
    message: `Child "${child.name}" (id: ${child.id}) is larger on ${axisText} (${deltas.join(', ')})`
  }
}

function findTextAncestorOverflow(
  graph: SceneGraph,
  child: SceneNode
): DetectedOverflow | null {
  const parent = child.parentId ? graph.getNode(child.parentId) : undefined
  let ancestor = parent?.parentId ? graph.getNode(parent.parentId) : undefined

  while (ancestor && ancestor.type !== 'CANVAS') {
    const overflow = compareTextAgainstAncestor(graph, child, ancestor)
    if (overflow) return { item: overflow, parentId: ancestor.id }
    ancestor = ancestor.parentId ? graph.getNode(ancestor.parentId) : undefined
  }

  return null
}

function groupOverflows(graph: SceneGraph, overflows: DetectedOverflow[]): OverflowGroup[] {
  const groups = new Map<string, OverflowGroup>()

  for (const detected of overflows) {
    const { item: overflow, parentId } = detected
    const parent = parentId ? graph.getNode(parentId) : undefined
    if (!parent) continue

    let group = groups.get(parent.id)
    if (!group) {
      group = {
        parent: toNodeSummary(parent),
        parentPath: relativeAncestorPath(graph, parent),
        overflows: []
      }
      groups.set(parent.id, group)
    }
    group.overflows.push(overflow)
  }

  return [...groups.values()]
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
      groups: [],
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
  const overflows: DetectedOverflow[] = []

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
    if (overflow) overflows.push({ item: overflow, parentId: parent.id })

    if (node.type === 'TEXT' && !overflow) {
      const ancestorOverflow = findTextAncestorOverflow(graph, node)
      if (ancestorOverflow) overflows.push(ancestorOverflow)
    }
  }

  overflows.sort((a, b) => {
    const aMax = Math.max(a.item.widthDelta, a.item.heightDelta)
    const bMax = Math.max(b.item.widthDelta, b.item.heightDelta)
    return bMax - aMax
  })

  const limit = Math.max(0, Number.isFinite(Number(args.limit)) ? Number(args.limit) : 100)
  const limitedOverflows = overflows.slice(0, limit)
  const groups = groupOverflows(graph, limitedOverflows)
  const axisCounts = { x: 0, y: 0, both: 0 }
  for (const { item } of overflows) {
    if (item.overflowX && item.overflowY) axisCounts.both++
    else if (item.overflowX) axisCounts.x++
    else if (item.overflowY) axisCounts.y++
  }

  return {
    groups,
    ...(groups.length > 0 ? { guidance: OVERFLOW_GUIDANCE } : {}),
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
