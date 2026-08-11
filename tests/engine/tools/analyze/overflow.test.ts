import { describe, expect, test } from 'bun:test'

import { FigmaAPI, SceneGraph } from '@open-pencil/core'
import {
  analyzeOverflow,
  computeOverflowDetections
} from '@open-pencil/core/tools/analyze/overflow'

import { frame, pageId, rect, text } from './overlaps/helpers'

describe('analyze overflow', () => {
  test('detects child wider than parent', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const parent = frame(graph, 'Parent', page, 0, 0, 100, 80)
    rect(graph, 'Wide Child', parent.id, 0, 0, 140, 60)

    const result = computeOverflowDetections(graph)
    expect(result.summary.overflowCount).toBe(1)
    expect(result.summary.axisCounts.x).toBe(1)
    expect(result.groups[0].overflows[0].overflowX).toBe(true)
    expect(result.groups[0].overflows[0].overflowY).toBe(false)
    expect(result.groups[0].overflows[0].widthDelta).toBe(40)
  })

  test('detects child taller than parent', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const parent = frame(graph, 'Parent', page, 0, 0, 100, 80)
    rect(graph, 'Tall Child', parent.id, 0, 0, 90, 120)

    const result = computeOverflowDetections(graph)
    expect(result.summary.overflowCount).toBe(1)
    expect(result.summary.axisCounts.y).toBe(1)
    expect(result.groups[0].overflows[0].overflowX).toBe(false)
    expect(result.groups[0].overflows[0].overflowY).toBe(true)
    expect(result.groups[0].overflows[0].heightDelta).toBe(40)
  })

  test('detects child larger on both axes', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const parent = frame(graph, 'Parent', page, 0, 0, 100, 80)
    rect(graph, 'Huge Child', parent.id, 0, 0, 140, 120)

    const result = computeOverflowDetections(graph)
    expect(result.summary.overflowCount).toBe(1)
    expect(result.summary.axisCounts.both).toBe(1)
    expect(result.groups[0].overflows[0].overflowX).toBe(true)
    expect(result.groups[0].overflows[0].overflowY).toBe(true)
  })

  test('supports parent scope descendants', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const board = frame(graph, 'Board', page, 0, 0, 300, 300)
    const card = frame(graph, 'Card', board.id, 0, 0, 100, 80)
    rect(graph, 'Wide Child', card.id, 0, 0, 140, 60)

    const result = computeOverflowDetections(graph, {
      parent_id: board.id,
      parent_scope: 'descendants'
    })
    expect(result.summary.overflowCount).toBe(1)
    expect(result.groups[0].parent.id).toBe(card.id)
  })

  test('detects text overflowing an ancestor after an intermediate frame expands', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const viewport = frame(graph, 'Viewport', page, 0, 0, 390, 300)
    const expandedContent = frame(graph, 'Expanded Content', viewport.id, 0, 0, 884, 100)
    const title = text(graph, 'Title', expandedContent.id, 24, 0, 836, 30)

    const result = computeOverflowDetections(graph)
    const titleOverflow = result.groups
      .flatMap((group) => group.overflows.map((overflow) => ({ group, overflow })))
      .find(({ overflow }) => overflow.child.id === title.id)

    expect(titleOverflow?.group.parent.id).toBe(viewport.id)
    expect(titleOverflow?.overflow.overflowX).toBe(true)
    expect(titleOverflow?.overflow.widthDelta).toBe(470)
  })

  test('tool executes against current page by default', () => {
    const graph = new SceneGraph()
    const figma = new FigmaAPI(graph)
    const parent = figma.createFrame()
    parent.name = 'Parent'
    parent.resize(100, 80)
    const child = figma.createRectangle()
    child.name = 'Wide Child'
    child.resize(140, 60)
    parent.appendChild(child)

    const result = analyzeOverflow.execute(figma, {}) as {
      summary: { overflowCount: number }
    }
    expect(result.summary.overflowCount).toBe(1)
  })
})
