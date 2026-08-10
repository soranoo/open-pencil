import { defineTool } from '#core/tools/schema'

import { generatePlanTaskId, getPlanStore } from './store'
import type { PlanStatus, PlanTask } from './store'

const STATUS_VALUES: PlanStatus[] = ['pending', 'in_progress', 'done', 'blocked']

function isPlanStatus(value: string): value is PlanStatus {
  return (STATUS_VALUES as string[]).includes(value)
}

async function collectDescendantIds(rootId: string): Promise<string[]> {
  const all = await getPlanStore().list()
  const byParent = new Map<string, PlanTask[]>()
  for (const t of all) {
    const key = t.parentId ?? ''
    const arr = byParent.get(key) ?? []
    arr.push(t)
    byParent.set(key, arr)
  }

  const result: string[] = []
  const stack = [rootId]
  while (stack.length > 0) {
    const id = stack.pop() as string
    for (const child of byParent.get(id) ?? []) {
      result.push(child.id)
      stack.push(child.id)
    }
  }
  return result
}

/** Computes "1", "1.1", "1.2", "2" style display numbers from tree order — kept
 *  separate from PlanTask.id so deleting/reordering never forces a renumber. */
function computeDisplayIds(tasks: PlanTask[]): Map<string, string> {
  const byParent = new Map<string, PlanTask[]>()
  for (const t of tasks) {
    const key = t.parentId ?? ''
    const arr = byParent.get(key) ?? []
    arr.push(t)
    byParent.set(key, arr)
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.order - b.order)

  const display = new Map<string, string>()
  function walk(parentKey: string, prefix: string): void {
    for (const [i, child] of (byParent.get(parentKey) ?? []).entries()) {
      const num = prefix ? `${prefix}.${i + 1}` : `${i + 1}`
      display.set(child.id, num)
      walk(child.id, num)
    }
  }
  walk('', '')
  return display
}

function sortByDisplayId(tasks: PlanTask[], displayIds: Map<string, string>): PlanTask[] {
  return [...tasks].sort((a, b) =>
    (displayIds.get(a.id) ?? '').localeCompare(displayIds.get(b.id) ?? '', undefined, { numeric: true })
  )
}

type PlanTaskWithDisplay = PlanTask & { display_id: string }
type PlanTreeNode = PlanTaskWithDisplay & { children: PlanTreeNode[] }

/** Nests tasks under their parent (only among the given task set — used after root_id scoping). */
function buildTree(tasks: PlanTask[], displayIds: Map<string, string>): PlanTreeNode[] {
  const ids = new Set(tasks.map((t) => t.id))
  const byParent = new Map<string, PlanTask[]>()
  for (const t of tasks) {
    const key = t.parentId && ids.has(t.parentId) ? t.parentId : ''
    const arr = byParent.get(key) ?? []
    arr.push(t)
    byParent.set(key, arr)
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.order - b.order)

  function build(parentKey: string): PlanTreeNode[] {
    return (byParent.get(parentKey) ?? []).map((t) => ({
      ...t,
      display_id: displayIds.get(t.id) ?? '',
      children: build(t.id)
    }))
  }
  return build('')
}

export const createPlanTask = defineTool({
  name: 'create_plan_task',
  description:
    'Add a task or subtask to the build plan. Phase 1 only — do not call this once building has started. If scope changes mid-build, that is a planning decision to make explicitly, not a tool call.',
  params: {
    title: {
      type: 'string',
      description: 'Short name, e.g. "Hero", "StoryCard3"',
      required: true
    },
    summary: {
      type: 'string',
      description: 'Dimensions + layout approach, e.g. "1440x500, image bg + overlay text, flex col"',
      required: true
    },
    parent_id: {
      type: 'string',
      description: 'Parent task ID to nest this under as a subtask. Omit for a top-level task.'
    },
    after_id: {
      type: 'string',
      description: 'Sibling task ID to insert after. Omit to append at the end of its sibling list.'
    }
  },
  execute: async (_figma, args) => {
    const store = getPlanStore()
    const parentId = args.parent_id ?? null
    const siblings = (await store.list()).filter((t) => t.parentId === parentId)

    let order = siblings.length
    if (args.after_id) {
      const after = siblings.find((t) => t.id === args.after_id)
      if (!after) return { error: `Sibling task "${args.after_id}" not found under the same parent` }
      order = after.order + 0.5
    }

    const now = Date.now()
    const task: PlanTask = {
      id: generatePlanTaskId(),
      title: args.title,
      summary: args.summary,
      status: 'pending',
      parentId,
      order,
      nodeId: null,
      notes: [],
      createdAt: now,
      updatedAt: now
    }
    await store.create(task)
    return { task }
  }
})

export const removePlanTask = defineTool({
  name: 'remove_plan_task',
  mutates: true,
  description:
    'Remove a task and its subtasks from the plan. If any of them are already linked to built canvas nodes (node_id), those nodes are deleted too — this removes real, already-built design content, not just a plan entry. Phase 1 only.',
  params: {
    id: { type: 'string', description: 'Task ID to remove', required: true },
    cascade: {
      type: 'boolean',
      description:
        'Also remove subtasks. Defaults to true — pass false to fail instead of removing if the task has subtasks.',
      default: true
    }
  },
  execute: async (figma, args) => {
    const store = getPlanStore()
    const task = await store.get(args.id)
    if (!task) return { error: `Plan task "${args.id}" not found` }

    const descendantIds = await collectDescendantIds(args.id)
    if (descendantIds.length > 0 && args.cascade === false) {
      return {
        error: `Task "${args.id}" has ${descendantIds.length} subtask(s). Pass cascade: true to remove them too.`
      }
    }

    const allIds = [args.id, ...descendantIds]
    const deletedNodeIds: string[] = []
    for (const id of allIds) {
      const t = await store.get(id)
      if (t?.nodeId) {
        const node = figma.getNodeById(t.nodeId)
        if (node) {
          node.remove()
          deletedNodeIds.push(t.nodeId)
        }
      }
      await store.delete(id)
    }

    return { removed_ids: allIds, deleted_node_ids: deletedNodeIds }
  }
})

export const checkoutPlanTask = defineTool({
  name: 'checkout_plan_task',
  description:
    'The only plan-mutating tool allowed after Phase 1. Switches the current task to id and, in the same call, records the outcome of the task you just finished via the close_* fields — so the plan stays an accurate build log instead of just a checklist. close_status: "done" means the task\'s content is actually built and correct (even if you had to fix issues like an overflow along the way); "blocked" means you moved on without finishing it — explain why in close_note. close_id + close_status are required whenever a task is currently checked out; only omit them on the very first checkout of the whole plan. Never silently switch tasks without closing the previous one.',
  params: {
    id: {
      type: 'string',
      description: 'Task ID to make current next. Omit only when closing out the last task with nothing left to start.'
    },
    close_id: {
      type: 'string',
      description: 'Task ID you are closing out — normally the task that was current before this call.'
    },
    close_status: {
      type: 'string',
      enum: ['done', 'blocked'],
      description:
        '"done" = the task\'s content is fully built and matches the plan. "blocked" = it could not be finished as planned and was left incomplete — close_note should say why. Required whenever close_id is set.'
    },
    close_node_id: {
      type: 'string',
      description: 'Design node ID produced for the closed task, if one was built. Leave unset if closed as "blocked" before anything was rendered.'
    },
    close_note: {
      type: 'string',
      description:
        'One line: what was built/fixed, or — for blocked — why it could not be completed. This is what list_plan_tasks surfaces as history.'
    }
  },
  execute: async (_figma, args) => {
    const store = getPlanStore()

    let closed: PlanTask | null = null
    if (args.close_id) {
      const closingTask = await store.get(args.close_id)
      if (!closingTask) return { error: `Plan task "${args.close_id}" not found` }
      if (!args.close_status) {
        return { error: 'close_status is required whenever close_id is set (use "done" or "blocked")' }
      }
      const notes = args.close_note ? [...closingTask.notes, args.close_note] : closingTask.notes
      await store.update(args.close_id, {
        status: args.close_status as PlanStatus,
        nodeId: args.close_node_id ?? closingTask.nodeId,
        notes
      })
      closed = await store.get(args.close_id)
    } else {
      const currentId = await store.getCurrentId()
      if (currentId) {
        return { error: 'A task is currently checked out. Pass close_id/close_status to close it before switching.' }
      }
    }

    let current: PlanTask | null = null
    if (args.id) {
      current = await store.get(args.id)
      if (!current) return { error: `Plan task "${args.id}" not found` }
      await store.update(args.id, { status: 'in_progress' })
      current = await store.get(args.id)
      await store.setCurrentId(args.id)
    } else {
      await store.setCurrentId(null)
    }

    const ancestors: PlanTask[] = []
    let cursor = current?.parentId ?? null
    while (cursor) {
      const parent = await store.get(cursor)
      if (!parent) break
      ancestors.unshift(parent)
      cursor = parent.parentId
    }

    return { current, closed, ancestors }
  }
})

export const listPlanTasks = defineTool({
  name: 'list_plan_tasks',
  description:
    'Read-only. Lists plan tasks, optionally scoped to one task\'s subtree (root_id) and/or filtered by status. Use status: ["done"] to check what is finished, status: ["pending","in_progress"] to see what is left, or root_id alone to inspect one section\'s tasks (e.g. every subtask under Sidebar, including Sidebar itself). Safe to call any time, in any phase.',
  params: {
    format: {
      type: 'string',
      enum: ['tree', 'flat'],
      description:
        'Default "tree" (nested by parent, still returned in display order). Forced to flat output when status is set, since a status-filtered tree would have gaps.',
      default: 'tree'
    },
    status: {
      type: 'string[]',
      enum: ['pending', 'in_progress', 'done', 'blocked'],
      description: 'Only return tasks whose status is one of these. Omit for all statuses.'
    },
    root_id: {
      type: 'string',
      description: 'Scope to this task plus all its descendants at any depth (the task itself is included). Omit for the whole plan.'
    }
  },
  execute: async (_figma, args) => {
    const store = getPlanStore()
    let tasks = await store.list()

    if (args.root_id) {
      const root = tasks.find((t) => t.id === args.root_id)
      if (!root) return { error: `Plan task "${args.root_id}" not found` }
      const descendantIds = new Set(await collectDescendantIds(args.root_id))
      tasks = tasks.filter((t) => t.id === args.root_id || descendantIds.has(t.id))
    }

    const displayIds = computeDisplayIds(tasks)

    if (args.status && args.status.length > 0) {
      const invalid = args.status.filter((s) => !isPlanStatus(s))
      if (invalid.length > 0) return { error: `Invalid status value(s): ${invalid.join(', ')}` }
      const statusSet = new Set(args.status)
      const filtered = sortByDisplayId(
        tasks.filter((t) => statusSet.has(t.status)),
        displayIds
      )
      // Flat regardless of requested format — a status-pruned tree would have gaps
      // where filtered-out ancestors used to be, which isn't a real tree.
      const flat: PlanTaskWithDisplay[] = filtered.map((t) => ({ ...t, display_id: displayIds.get(t.id) ?? '' }))
      return { plan: flat }
    }

    if ((args.format ?? 'tree') === 'flat') {
      const ordered = sortByDisplayId(tasks, displayIds)
      const flat: PlanTaskWithDisplay[] = ordered.map((t) => ({ ...t, display_id: displayIds.get(t.id) ?? '' }))
      return { plan: flat }
    }

    return { plan: buildTree(tasks, displayIds) }
  }
})
