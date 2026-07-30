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
import { ref, watch } from 'vue'

import { exportFigFile } from '@open-pencil/core/io/formats/fig'

import type { paths } from '@/__generated__/server-api-types'
import { serverReadOnly } from '@/app/automation/view-only-bridge'
import { useActiveEditorStoreRef } from '@/app/editor/active-store'
import { fadeOutGlobalLoader } from '@/app/editor/canvas/loader-overlay'
import { openFileInNewTab } from '@/app/tabs'
import { IS_BACKEND_MODE } from '@/constants'

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
let refreshTimer: ReturnType<typeof setInterval> | null = null

type DesignAuthStatus = 'idle' | 'authenticating' | 'authenticated' | 'unauth'

interface DesignAuthSuccess {
  authenticated: true
  designId: string
  permission: 'read' | 'write'
  refreshIntervalMs: number
  cookieExpiresAt: number
  source: 'cookie' | 'signed-url'
}

interface DesignJsonPayload {
  designId: string
  metadata: {
    id: string
    promptHistory: unknown[]
    s3Key: string
  }
  dataBase64: string
}

export const designAuthStatus = ref<DesignAuthStatus>('idle')
export const designAuthError = ref<string | null>(null)
export const designPermission = ref<'read' | 'write'>('read')

function resolveDesignId(designId?: string): string {
  const resolved = designId ?? activeServerDesignId
  if (!resolved) {
    throw new Error(
      'No server design id is active. Load a server design first, or pass designId explicitly.'
    )
  }
  return resolved
}

function getSignedDesignQuery(designId: string): URLSearchParams | null {
  const params = new URLSearchParams(location.search)
  if (params.get('design') !== designId) {
    return null
  }
  if (!params.get('key') || !params.get('expiry') || !params.get('sign')) {
    return null
  }
  return params
}

function stopCookieRefreshTimer(): void {
  if (!refreshTimer) return
  clearInterval(refreshTimer)
  refreshTimer = null
}

async function requestDesignIframeAuth(designId: string): Promise<DesignAuthSuccess> {
  const query = getSignedDesignQuery(designId)
  const authUrl = new URL(`${SERVER_URL}/api/v1/design/${designId}/auth`)
  if (query) {
    for (const key of ['design', 'key', 'expiry', 'permission', 'sign']) {
      const value = query.get(key)
      if (value) authUrl.searchParams.set(key, value)
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)

  try {
    const response = await fetch(authUrl, {
      credentials: 'include',
      signal: controller.signal
    })
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(errorBody?.error ?? `Design auth failed with ${response.status}`)
    }

    return (await response.json()) as DesignAuthSuccess
  } finally {
    clearTimeout(timeout)
  }
}

function updateReadOnlyFromPermission(permission: 'read' | 'write'): void {
  designPermission.value = permission
  serverReadOnly.value = permission !== 'write'
}

function startCookieRefreshTimer(designId: string, refreshIntervalMs: number): void {
  stopCookieRefreshTimer()
  if (!getSignedDesignQuery(designId)) {
    return
  }

  refreshTimer = setInterval(
    () => {
      void ensureDesignIframeAuth(designId, { silent: true }).catch((error) => {
        console.error('[server-bridge] failed to refresh design cookie:', error)
      })
    },
    Math.max(60_000, refreshIntervalMs)
  )
}

export async function ensureDesignIframeAuth(
  designId: string,
  options?: { silent?: boolean }
): Promise<DesignAuthSuccess> {
  console.error({ options })
  if (!options?.silent) {
    designAuthStatus.value = 'authenticating'
    designAuthError.value = null
  }

  try {
    const auth = await requestDesignIframeAuth(designId)
    updateReadOnlyFromPermission(auth.permission)
    designAuthStatus.value = 'authenticated'
    designAuthError.value = null
    startCookieRefreshTimer(designId, auth.refreshIntervalMs)
    return auth
  } catch (error) {
    stopCookieRefreshTimer()
    serverReadOnly.value = true
    designAuthStatus.value = 'unauth'
    designAuthError.value =
      error instanceof Error ? error.message : 'Unauthorized design access'
    fadeOutGlobalLoader()
    throw error
  }
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
  await ensureDesignIframeAuth(designId)

  const fetchController = new AbortController()
  const fetchTimeout = setTimeout(() => fetchController.abort(), 30_000)

  let response: Response
  try {
    response = await fetch(`${SERVER_URL}/api/v1/design/${designId}?format=json`, {
      credentials: 'include',
      signal: fetchController.signal
    })
  } catch (err) {
    clearTimeout(fetchTimeout)
    designAuthStatus.value = 'unauth'
    designAuthError.value = err instanceof Error ? err.message : 'Failed to load design data'
    throw err
  }
  clearTimeout(fetchTimeout)

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null
    designAuthStatus.value = 'unauth'
    designAuthError.value = errorBody?.error ?? `Load failed with ${response.status}`
    throw new Error(errorBody?.error ?? `Load failed with ${response.status}`)
  }

  const data = (await response.json()) as DesignJsonPayload

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
  if (designPermission.value !== 'write') {
    throw new Error('This signed design URL does not allow saving changes')
  }
  const store = window.openPencil?.getStore?.()
  if (!store) {
    throw new Error('window.openPencil.getStore() returned null or undefined')
  }

  const bytes = await exportFigFile(store.graph)

  const blob = new Blob([new Uint8Array(bytes)], {
    type: 'application/octet-stream'
  })

  const response = await fetch(`${SERVER_URL}/api/v1/design/${designId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/octet-stream'
    },
    body: blob
  })

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(errorBody?.error ?? `Save failed with ${response.status}`)
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
  designAuthStatus.value = 'authenticating'
  void loadDesignFromServer(designId).catch((err) => {
    console.error('[server-bridge] failed to autoload design from ?designId=', err)
    designAuthStatus.value = 'unauth'
    designAuthError.value = err instanceof Error ? err.message : 'Failed to load design'
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
