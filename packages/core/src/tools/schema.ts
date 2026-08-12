/**
 * Tool definition schema.
 *
 * Each tool is defined once with typed params and an execute function
 * that operates on FigmaAPI. Adapters for AI chat (valibot), CLI (citty),
 * and MCP (JSON Schema) are generated from these definitions.
 */

import type { SceneNode } from '@open-pencil/scene-graph'

import type { FigmaAPI, FigmaNodeProxy } from '#core/figma-api'

export type ParamType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'color'
  | 'string[]'
  | 'string[][]'
  | 'object'
  | 'object[]'

export interface ParamDef {
  type: ParamType
  description: string
  required?: boolean
  default?: unknown
  enum?: string[]
  min?: number
  max?: number
  properties?: Record<string, ParamDef>
}

export interface ToolDef {
  name: string
  description: string
  mutates?: boolean
  params: Record<string, ParamDef>
  execute: (figma: FigmaAPI, args: Record<string, unknown>) => unknown
}

type ResolvedValue<P extends ParamDef> = P['type'] extends 'string'
  ? string
  : P['type'] extends 'number'
    ? number
    : P['type'] extends 'boolean'
      ? boolean
      : P['type'] extends 'color'
        ? string
        : P['type'] extends 'string[]'
          ? string[]
          : P['type'] extends 'string[][]'
            ? string[][]
          : P['type'] extends 'object'
            ? P['properties'] extends Record<string, ParamDef>
              ? ResolvedParams<P['properties']>
              : Record<string, unknown>
            : P['type'] extends 'object[]'
              ? P['properties'] extends Record<string, ParamDef>
                ? Array<ResolvedParams<P['properties']>>
                : Array<Record<string, unknown>>
              : never

type ResolvedParams<P extends Record<string, ParamDef>> = {
  [K in keyof P as P[K]['required'] extends true ? K : never]: ResolvedValue<P[K]>
} & {
  [K in keyof P as P[K]['required'] extends true ? never : K]?: ResolvedValue<P[K]>
}

export function defineTool<P extends Record<string, ParamDef>>(def: {
  name: string
  description: string
  mutates?: boolean
  params: P
  execute: (figma: FigmaAPI, args: ResolvedParams<P>) => unknown
}): ToolDef {
  return def as ToolDef
}

export class NodeNotFoundError extends Error {
  constructor(id: string) {
    super(`Node not found: ${id}`)
    this.name = 'NodeNotFoundError'
  }
}

export function requireNode(figma: FigmaAPI, id: string): ReturnType<FigmaAPI['getNodeById']> {
  const node = figma.getNodeById(id)
  if (!node) throw new NodeNotFoundError(id)
  return node
}

export function nodeNotFound(id: string): { error: string } {
  return { error: `Node "${id}" not found` }
}

export function getRawNodeOrError(
  figma: FigmaAPI,
  id: string
): { node: SceneNode } | { error: string } {
  const node = figma.graph.getNode(id)
  return node ? { node } : nodeNotFound(id)
}

export function nodeToResult(node: FigmaNodeProxy, maxDepth?: number): Record<string, unknown> {
  return node.toJSON(maxDepth)
}

export function nodeSummary(node: FigmaNodeProxy): { id: string; name: string; type: string } {
  return { id: node.id, name: node.name, type: node.type }
}
