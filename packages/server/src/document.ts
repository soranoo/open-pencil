// This file has no upstream equivalent — it's the minimal headless replacement for what
// makeFigmaFromStore(store) does in src/app/automation/bridge/figma-factory.ts, minus the
// live EditorStore (renderer, undo stack, canvas) that a browser session provides.
//
// Confirmed against the published @open-pencil/core package:
//   - SceneGraph's bare constructor already seeds one default page
//     (packages/core/src/editor/create.ts:48 in the source repo does `new SceneGraph()`)
//   - FigmaAPI(graph) takes just a SceneGraph — packages/cli/src/commands/eval.ts does
//     exactly this in "file mode" with no store/renderer involved
//   - IORegistry.readDocument / writeDocument are the same codec the CLI and the app use

import { FigmaAPI } from '@open-pencil/core/figma-api'
import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { SceneGraph } from '@open-pencil/core/scene-graph'

const io = new IORegistry(BUILTIN_IO_FORMATS)

export interface DocumentHandle {
  graph: SceneGraph
  figma: FigmaAPI
}

/** Brand-new blank document — equivalent to "New Design" with no id yet. */
export function createBlankDocument(): DocumentHandle {
  const graph = new SceneGraph()
  return { graph, figma: new FigmaAPI(graph) }
}

/** Re-hydrate a previously-saved document from raw .fig/.pen bytes. */
export async function loadDocument(bytes: Uint8Array, fileName = 'design.fig'): Promise<DocumentHandle> {
  const { graph } = await io.readDocument({ name: fileName, data: bytes })
  computeAllLayouts(graph)
  return { graph, figma: new FigmaAPI(graph) }
}

/** Serialize the current in-memory graph to .fig bytes for persistence. */
export async function serializeDocument(graph: SceneGraph): Promise<Uint8Array> {
  const result = await io.writeDocument('fig', graph)
  return result.data as Uint8Array
}
