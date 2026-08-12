import type { FigmaAPI, FigmaNodeProxy } from '#core/figma-api'
import { defineTool } from '#core/tools/schema'

export const arrangeNodes = defineTool({
  name: 'arrange',
  mutates: true,
  description:
    'Arrange top-level nodes on the canvas in a grid, row, or column layout. Useful after batch creation to tidy up overlapping frames.',
  params: {
    ids: { type: 'string[]', description: 'Node IDs to arrange (default: all top-level children)' },
    mode: {
      type: 'string',
      description: 'Layout mode',
      enum: ['grid', 'row', 'column'],
      default: 'grid'
    },
    gap: { type: 'number', description: 'Spacing between nodes (default: 40)' },
    cols: { type: 'number', description: 'Column count for grid mode (default: auto)' }
  },
  execute: (figma, args) => {
    const gap = args.gap ?? 40
    const mode = args.mode ?? 'grid'
    const page = figma.currentPage

    let nodes: FigmaNodeProxy[]
    if (args.ids && args.ids.length > 0) {
      nodes = args.ids
        .map((id) => figma.getNodeById(id))
        .filter((node): node is FigmaNodeProxy => node !== null)
    } else {
      nodes = [...page.children]
    }

    if (nodes.length === 0) return { error: 'No nodes to arrange' }
    const first = nodes[0]

    if (mode === 'row') {
      arrangeRow(nodes, first.x, first.y, gap)
    } else if (mode === 'column') {
      arrangeColumn(nodes, first.x, first.y, gap)
    } else {
      arrangeGrid(nodes, first.x, first.y, args.cols ?? Math.ceil(Math.sqrt(nodes.length)), gap)
    }

    return { arranged: nodes.length, mode }
  }
})

function arrangeRow(nodes: FigmaNodeProxy[], startX: number, y: number, gap: number) {
  let x = startX
  for (const node of nodes) {
    node.x = x
    node.y = y
    x += node.width + gap
  }
}

export const arrangeRows = defineTool({
  name: 'arrange_rows',
  mutates: true,
  description:
    'Arrange nodes in explicit irregular rows. Each nested row is placed left-to-right, and rows are placed top-to-bottom.',
  params: {
    rows: {
      type: 'string[][]',
      description:
        'Rows of node IDs. Example: [["id1", "id2"], ["id3"], ["id4", "id5", "id6"]].',
      required: true,
    },
    gap: { type: 'number', description: 'Fallback spacing between nodes and rows (default: 40)' },
    gap_x: { type: 'number', description: 'Horizontal spacing between nodes (default: gap)' },
    gap_y: { type: 'number', description: 'Vertical spacing between rows (default: gap)' },
  },
  execute: (figma, args) => {
    const rows = resolveRows(figma, args.rows)
    const nodes = rows.flat()
    if (nodes.length === 0) return { error: 'No valid nodes to arrange' }

    const gap = args.gap ?? 40
    arrangeRowsLayout(
      rows,
      nodes[0].x,
      nodes[0].y,
      args.gap_x ?? gap,
      args.gap_y ?? gap,
    )
    return { arranged: nodes.length, rowCount: rows.length, mode: 'rows' }
  },
})

function resolveRows(figma: FigmaAPI, rows: string[][]): FigmaNodeProxy[][] {
  return rows
    .map((row) =>
      row
        .map((id) => figma.getNodeById(id))
        .filter((node): node is FigmaNodeProxy => node !== null)
    )
    .filter((row) => row.length > 0)
}

function arrangeRowsLayout(
  rows: FigmaNodeProxy[][],
  startX: number,
  startY: number,
  gapX: number,
  gapY: number,
) {
  let y = startY

  for (const row of rows) {
    let x = startX
    let rowHeight = 0

    for (const node of row) {
      node.x = x
      node.y = y
      x += node.width + gapX
      rowHeight = Math.max(rowHeight, node.height)
    }

    y += rowHeight + gapY
  }
}

function arrangeColumn(nodes: FigmaNodeProxy[], x: number, startY: number, gap: number) {
  let y = startY
  for (const node of nodes) {
    node.x = x
    node.y = y
    y += node.height + gap
  }
}

function arrangeGrid(
  nodes: FigmaNodeProxy[],
  startX: number,
  startY: number,
  cols: number,
  gap: number
) {
  let x = startX
  let y = startY
  let rowHeight = 0

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]
    if (index > 0 && index % cols === 0) {
      x = startX
      y += rowHeight + gap
      rowHeight = 0
    }
    node.x = x
    node.y = y
    x += node.width + gap
    rowHeight = Math.max(rowHeight, node.height)
  }
}
