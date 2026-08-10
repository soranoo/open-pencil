/**
 * Plan store — tracks the build plan (Phase 1 tasks/subtasks) separately
 * from the scene graph, so the agent can create/remove/checkout tasks and
 * read back status + history at any point in the build.
 *
 * Swappable backend, default in-memory. Mirrors the existing
 * swappable-provider pattern in this package: layout/text-measurement.ts
 * (setTextMeasurer/getTextMeasurer) and tools/stock-photo/providers.ts.
 */

export type PlanStatus = 'pending' | 'in_progress' | 'done' | 'blocked'

export interface PlanTask {
  id: string
  title: string
  summary: string
  status: PlanStatus
  /** null = top-level task */
  parentId: string | null
  /** sibling ordering key; display numbering ("1", "1.1", "2") is derived from this, not stored */
  order: number
  /** design node ID once this task has been built, else null */
  nodeId: string | null
  /** running history log — outcomes recorded by checkout_plan_task */
  notes: string[]
  createdAt: number
  updatedAt: number
}

export interface PlanStore {
  list(): Promise<PlanTask[]>
  get(id: string): Promise<PlanTask | null>
  create(task: PlanTask): Promise<void>
  update(id: string, patch: Partial<PlanTask>): Promise<void>
  delete(id: string): Promise<void>
  getCurrentId(): Promise<string | null>
  setCurrentId(id: string | null): Promise<void>
  clear(): Promise<void>
}

let nextLocalTaskNum = 1

/** Opaque, stable task ID — not a display number. See computeDisplayIds in tasks.ts. */
export function generatePlanTaskId(): string {
  return `plan_${Date.now().toString(36)}_${nextLocalTaskNum++}`
}

/** Default backend — process-local, lost on reload. Used by CLI/MCP/in-app chat unless overridden. */
export class MemoryPlanStore implements PlanStore {
  protected tasks = new Map<string, PlanTask>()
  protected currentId: string | null = null

  async list(): Promise<PlanTask[]> {
    return [...this.tasks.values()]
  }

  async get(id: string): Promise<PlanTask | null> {
    return this.tasks.get(id) ?? null
  }

  async create(task: PlanTask): Promise<void> {
    this.tasks.set(task.id, task)
  }

  async update(id: string, patch: Partial<PlanTask>): Promise<void> {
    const existing = this.tasks.get(id)
    if (!existing) return
    this.tasks.set(id, { ...existing, ...patch, id, updatedAt: Date.now() })
  }

  async delete(id: string): Promise<void> {
    this.tasks.delete(id)
    if (this.currentId === id) this.currentId = null
  }

  async getCurrentId(): Promise<string | null> {
    return this.currentId
  }

  async setCurrentId(id: string | null): Promise<void> {
    this.currentId = id
  }

  async clear(): Promise<void> {
    this.tasks.clear()
    this.currentId = null
  }
}

/**
 * Minimal string-KV shape, intentionally duplicated from
 * packages/server/src/kv/interface.ts. The core package cannot depend on
 * the server package (server depends on core, not the reverse), so this is
 * a structural (duck-typed) copy: any object satisfying this shape —
 * including the server's real Redis/fs/memory KvStore instances — works
 * here without an import. Keep this in sync by hand if the server's
 * KvStore interface ever changes shape.
 */
export interface KvLike {
  set(key: string, value: string, ttlMs?: number): Promise<void>
  get(key: string): Promise<string | null>
  delete(key: string): Promise<void>
  has(key: string): Promise<boolean>
}

/**
 * KV-backed PlanStore — stores the whole plan as one JSON blob per document
 * (KvLike has no list/scan, so per-task keys aren't an option) plus one key
 * for the current-task pointer. Works with any KvLike, e.g. the server
 * package's real KvStore.
 */
export class KvPlanStore implements PlanStore {
  constructor(
    private kv: KvLike,
    private namespace: string
  ) {}

  private tasksKey(): string {
    return `plan:${this.namespace}:tasks`
  }

  private currentKey(): string {
    return `plan:${this.namespace}:current`
  }

  async list(): Promise<PlanTask[]> {
    const raw = await this.kv.get(this.tasksKey())
    return raw ? (JSON.parse(raw) as PlanTask[]) : []
  }

  private async saveAll(tasks: PlanTask[]): Promise<void> {
    await this.kv.set(this.tasksKey(), JSON.stringify(tasks))
  }

  async get(id: string): Promise<PlanTask | null> {
    const tasks = await this.list()
    return tasks.find((t) => t.id === id) ?? null
  }

  async create(task: PlanTask): Promise<void> {
    const tasks = await this.list()
    tasks.push(task)
    await this.saveAll(tasks)
  }

  async update(id: string, patch: Partial<PlanTask>): Promise<void> {
    const tasks = await this.list()
    const idx = tasks.findIndex((t) => t.id === id)
    if (idx === -1) return
    tasks[idx] = { ...tasks[idx], ...patch, id, updatedAt: Date.now() }
    await this.saveAll(tasks)
  }

  async delete(id: string): Promise<void> {
    const tasks = await this.list()
    await this.saveAll(tasks.filter((t) => t.id !== id))
    const currentId = await this.getCurrentId()
    if (currentId === id) await this.setCurrentId(null)
  }

  async getCurrentId(): Promise<string | null> {
    return this.kv.get(this.currentKey())
  }

  async setCurrentId(id: string | null): Promise<void> {
    if (id === null) {
      await this.kv.delete(this.currentKey())
    } else {
      await this.kv.set(this.currentKey(), id)
    }
  }

  async clear(): Promise<void> {
    await this.kv.delete(this.tasksKey())
    await this.kv.delete(this.currentKey())
  }
}

let activeStore: PlanStore = new MemoryPlanStore()

/** Called once per session by the server package to swap in a KvPlanStore. */
export function setPlanStore(store: PlanStore): void {
  activeStore = store
}

export function getPlanStore(): PlanStore {
  return activeStore
}
