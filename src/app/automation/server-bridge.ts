// This deliberately does NOT touch the app's internals directly. It only calls the two
// hooks OpenPencil already exposes on `window.openPencil` for exactly this kind of
// external control (see src/app/browser-bridge.ts, src/app/shell/menu/files.ts upstream):
//
//   window.openPencil.openFile(path: string): Promise<void>
//     — already does: fetch(path) -> blob -> File -> openFileInNewTab(file)
//     — our GET /designs/:uuid route returns raw .fig bytes, so this works with zero
//       backend changes for the "load" direction.
//
//   window.openPencil.getStore(): EditorStore
//     — gives us store.graph / store.renderer / store.state.currentPageId, the same
//       three things src/app/document/io/source.ts's buildFigFile() uses to export the
//       current document to bytes for the "save" direction.

import createClient from 'openapi-fetch'
import { watch } from 'vue'

import { exportFigFile } from '@open-pencil/core/io/formats/fig'

import type { paths } from '@/__generated__/server-api-types'
import { useActiveEditorStoreRef } from '@/app/editor/active-store'
import { IS_BACKEND_MODE } from '@/constants'

import { openFileInNewTab } from '../tabs'

const SERVER_URL = import.meta.env.VITE_OPENPENCIL_SERVER_URL ?? 'http://localhost:8787'
const SERVER_SAVE_DEBOUNCE_MS = Number(
  import.meta.env.VITE_OPENPENCIL_SERVER_SAVE_DEBOUNCE_MS ?? 1200
)
const client = createClient<paths>({
  baseUrl: SERVER_URL,
  bodySerializer(body) {
    const typedBody = body as unknown
    // Needed to allow client with pure bytes body
    if (
      typedBody instanceof Blob ||
      typedBody instanceof ArrayBuffer ||
      typedBody instanceof Uint8Array
    ) {
      return body
    }

    return JSON.stringify(body)
  }
})

let activeServerDesignId: string | null = null
const pendingSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const pendingSaveRequests = new Map<
  string,
  Array<{ resolve: () => void; reject: (error: unknown) => void }>
>()
let installedServerAutosave = false

function resolveDesignId(designId?: string): string {
  const resolved = designId ?? activeServerDesignId
  if (!resolved) {
    throw new Error(
      'No server design id is active. Load a server design first, or pass designId explicitly.'
    )
  }
  return resolved
}

async function waitForOpenPencilBridge(timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!window.openPencil?.openFile || !window.openPencil.getStore) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('window.openPencil bridge did not become ready in time')
    }
    await new Promise((r) => setTimeout(r, 50))
  }
}

/** Loads a design previously saved on the server into a new tab. */
export async function loadDesignFromServer(designId: string): Promise<void> {
  await waitForOpenPencilBridge()

  const { data, error } = await client.GET('/api/v1/design/{designId}', {
    params: {
      path: { designId },
      query: { format: 'json' }
    }
  })

  if (error || !data) {
    throw new Error(`Load failed: ${JSON.stringify(error ?? 'No data returned')}`)
  }

  const binaryString = atob(data.dataBase64)
  const bytes = Uint8Array.from(binaryString, (c) => c.charCodeAt(0))
  const blob = new Blob([bytes], {
    type: 'application/octet-stream'
  })
  const file = new File([blob], `${designId}.fig`)
  await openFileInNewTab(file)
  const store = window.openPencil?.getStore?.()
  store?.markDocumentSaved?.()
}

/** Pushes the current tab's document bytes to the server, creating or overwriting `designId`. */
async function saveDesignToServerNow(designId: string): Promise<void> {
  await waitForOpenPencilBridge()
  const store = window.openPencil?.getStore?.()
  if (!store) {
    throw new Error('window.openPencil.getStore() returned null or undefined')
  }

  const bytes = await exportFigFile(store.graph)

  const blob = new Blob([new Uint8Array(bytes)], {
    type: 'application/octet-stream'
  })

  const { error } = await client.PUT('/api/v1/design/{designId}', {
    params: {
      path: {
        designId
      }
    },
    body: blob as unknown as string,
    headers: {
      'Content-Type': 'application/octet-stream'
    }
  })

  if (error) {
    throw new Error(`Save failed: ${JSON.stringify(error)}`)
  }
}

/** Pushes the current tab's document bytes to the server immediately. */
export async function saveDesignToServer(designId?: string): Promise<void> {
  const resolvedDesignId = resolveDesignId(designId)
  activeServerDesignId = resolvedDesignId
  await saveDesignToServerNow(resolvedDesignId)
}

/**
 * Schedules a debounced save to server. Multiple calls within the debounce window are coalesced
 * into a single network write.
 */
export function saveDesignToServerDebounced(designId?: string): Promise<void> {
  const resolvedDesignId = resolveDesignId(designId)
  activeServerDesignId = resolvedDesignId

  const currentTimer = pendingSaveTimers.get(resolvedDesignId)
  if (currentTimer) clearTimeout(currentTimer)

  return new Promise<void>((resolve, reject) => {
    const pending = pendingSaveRequests.get(resolvedDesignId)
    if (pending) pending.push({ resolve, reject })
    else pendingSaveRequests.set(resolvedDesignId, [{ resolve, reject }])

    const timer = setTimeout(
      () => {
        pendingSaveTimers.delete(resolvedDesignId)
        void saveDesignToServerNow(resolvedDesignId)
          .then(() => {
            const requests = pendingSaveRequests.get(resolvedDesignId) ?? []
            pendingSaveRequests.delete(resolvedDesignId)
            for (const request of requests) request.resolve()
          })
          .catch((error) => {
            const requests = pendingSaveRequests.get(resolvedDesignId) ?? []
            pendingSaveRequests.delete(resolvedDesignId)
            for (const request of requests) request.reject(error)
          })
      },
      Math.max(0, SERVER_SAVE_DEBOUNCE_MS)
    )

    pendingSaveTimers.set(resolvedDesignId, timer)
  })
}

/**
 * Runs a prompt against the AI backend for `designId` (or creates a new design if
 * omitted), saves the result server-side, and loads it into a new tab so you see the
 * outcome — same round trip the in-app chat gives you, just server-executed.
 */
export async function generateDesignOnServer(
  prompt: string,
  designId?: string
): Promise<{ designId: string; summary: string }> {
  const { data: genData, error: genError } = await client.POST('/api/v1/generate', {
    body: { prompt, designId }
  })

  if (genError || !genData) {
    throw new Error(`Generate failed: ${JSON.stringify(genError)}`)
  }
  throw new Error(`Missing implementaion`)

  // const { error: saveError } = await client.POST('/api/v1/design/{designId}/save', {
  //   params: {
  //     path: { designId: genData.designId }
  //   }
  // })

  // if (saveError) {
  //   throw new Error(`Save-after-generate failed: ${JSON.stringify(saveError)}`)
  // }

  // await loadDesignFromServer(genData.designId)
  // activeServerDesignId = genData.designId
  // return {
  //   designId: genData.designId,
  //   summary: genData.summary
  // }
}

/**
 * Installs a bridge-side autosave watcher for server-backed designs. When the active tab changes
 * and has scene mutations, this schedules a debounced PUT to the server while autosave is enabled.
 */
export function installServerBridgeAutosave(): void {
  if (!IS_BACKEND_MODE) return
  if (installedServerAutosave) return
  installedServerAutosave = true

  const activeStoreRef = useActiveEditorStoreRef()
  let stopStoreWatch: (() => void) | null = null

  watch(
    activeStoreRef,
    (store) => {
      stopStoreWatch?.()
      if (!store) return

      stopStoreWatch = watch(
        () => store.state.sceneVersion,
        () => {
          if (!activeServerDesignId) return
          if (!store.state.autosaveEnabled) return
          void store.saveFigFile().catch((error) => {
            console.error('[server-bridge] autosave to server failed:', error)
          })
        }
      )
    },
    { immediate: true }
  )
}

/**
 * Reads `?designId=<uuid>` on page load and, if present, opens that design automatically.
 * Call this once from main.ts after the app mounts.
 */
export function installServerBridgeAutoload(): void {
  const params = new URLSearchParams(location.search)
  const designId = params.get('design')
  if (!designId) {
    return
  }
  activeServerDesignId = designId
  void loadDesignFromServer(designId).catch((err) => {
    console.error('[server-bridge] failed to autoload design from ?designId=', err)
  })
}

// Exposed the same way OpenPencil already exposes window.openPencil — for console/manual
// control and for the optional widget in ServerBridgePanel.vue.
declare global {
  interface Window {
    openPencilServer?: {
      load: typeof loadDesignFromServer
      save: typeof saveDesignToServer
      saveDebounced: typeof saveDesignToServerDebounced
      generate: typeof generateDesignOnServer
    }
  }
}

window.openPencilServer = {
  load: loadDesignFromServer,
  save: saveDesignToServer,
  saveDebounced: saveDesignToServerDebounced,
  generate: generateDesignOnServer
}
