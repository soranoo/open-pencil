/**
 * Remote-control handler for `fig.download`.
 *
 * Reuses the exact same encoder the app's own Save/Save As flow uses
 * (`exportFigFile` from `@open-pencil/core/io`, see
 * `src/app/document/io/source.ts#buildFigFile`), but skips the browser
 * download / native file-picker path entirely (`downloadBlob`,
 * `chooseBrowserFigSaveHandle`, `chooseTauriFigSavePath` in
 * `src/app/document/io/save.ts`) since a server-side caller has no UI to
 * click through. The raw bytes are returned to the hub as base64 instead.
 */
import { encodeBase64 } from '@open-pencil/core/bytes'
import { exportFigFile } from '@open-pencil/core/io'
import type { FigDownloadResult } from '@open-pencil/automation/protocol'

import { getActiveEditorStore } from '@/app/editor/active-store'

function sanitizeFilename(name: string): string {
  const trimmed = name.trim().replace(/[\\/:*?"<>|]/g, '_')
  return trimmed.length > 0 ? trimmed : 'Untitled'
}

export async function handleFigDownload(): Promise<FigDownloadResult> {
  const store = getActiveEditorStore()

  let bytes: Uint8Array
  try {
    bytes = await exportFigFile(
      store.graph,
      undefined,
      store.renderer ?? undefined,
      store.state.currentPageId
    )
  } catch (error) {
    throw Object.assign(
      new Error(error instanceof Error ? error.message : 'Failed to build .fig file'),
      { code: 'FIG_EXPORT_FAILED' }
    )
  }

  return {
    filename: `${sanitizeFilename(store.state.documentName || 'Untitled')}.fig`,
    mimeType: 'application/octet-stream',
    base64: encodeBase64(bytes),
    byteLength: bytes.byteLength
  }
}
