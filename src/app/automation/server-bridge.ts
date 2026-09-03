import { ref, watch } from 'vue'

import {
  OPENPENCIL_SERVER_SAVE_DEBOUNCE_MS,
  OPENPENCIL_SERVER_URL
} from '@/app/config/frontend-env'
import { useActiveEditorStoreRef } from '@/app/editor/active-store'

type DesignAuthStatus = 'idle' | 'authenticating' | 'authenticated' | 'unauth'

interface DesignAuthResponse {
  permission: 'read' | 'write'
  refreshIntervalMs: number
}

export const designAuthStatus = ref<DesignAuthStatus>('idle')
export const designAuthError = ref<string | null>(null)
export const designPermission = ref<'read' | 'write'>('read')

let activeServerDesignId: string | null = null
let installedServerAutosave = false
let refreshTimer: ReturnType<typeof setInterval> | null = null
const pendingSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const pendingSaveRequests = new Map<
  string,
  Array<{ resolve: () => void; reject: (error: unknown) => void }>
>()

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const error = body.error
    if (typeof error === 'string') return error
  }
  return fallback
}

async function waitForOpenPencilStore(timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!window.openPencil?.getStore) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('window.openPencil bridge did not become ready in time')
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

function signedDesignQuery(designId: string): URLSearchParams | null {
  const params = new URLSearchParams(window.location.search)
  if (params.get('design') !== designId) return null
  if (!params.get('key') || !params.get('expiry') || !params.get('sign')) return null
  return params
}

function stopCookieRefreshTimer(): void {
  if (!refreshTimer) return
  clearInterval(refreshTimer)
  refreshTimer = null
}

async function requestDesignAuth(designId: string): Promise<DesignAuthResponse> {
  const query = signedDesignQuery(designId)
  const authUrl = new URL(`${OPENPENCIL_SERVER_URL}/api/v1/design/${designId}/auth`)
  if (query) {
    for (const key of ['design', 'key', 'expiry', 'permission', 'sign']) {
      const value = query.get(key)
      if (value) authUrl.searchParams.set(key, value)
    }
  }

  const response = await fetch(authUrl, { credentials: 'include' })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(errorMessage(body, `Design auth failed with ${response.status}`))
  }
  if (
    typeof body !== 'object' ||
    body === null ||
    !('permission' in body) ||
    (body.permission !== 'read' && body.permission !== 'write') ||
    !('refreshIntervalMs' in body) ||
    typeof body.refreshIntervalMs !== 'number'
  ) {
    throw new Error('Design auth returned an invalid response')
  }
  return { permission: body.permission, refreshIntervalMs: body.refreshIntervalMs }
}

function startCookieRefreshTimer(designId: string, refreshIntervalMs: number): void {
  stopCookieRefreshTimer()
  if (!signedDesignQuery(designId)) return
  refreshTimer = setInterval(
    () => {
      void ensureDesignAuth(designId, true).catch(() => undefined)
    },
    Math.max(60_000, refreshIntervalMs)
  )
}

export async function ensureDesignAuth(
  designId: string,
  silent = false
): Promise<DesignAuthResponse> {
  if (!silent) {
    designAuthStatus.value = 'authenticating'
    designAuthError.value = null
  }

  try {
    const auth = await requestDesignAuth(designId)
    designPermission.value = auth.permission
    designAuthStatus.value = 'authenticated'
    designAuthError.value = null
    startCookieRefreshTimer(designId, auth.refreshIntervalMs)
    return auth
  } catch (error) {
    stopCookieRefreshTimer()
    designPermission.value = 'read'
    designAuthStatus.value = 'unauth'
    designAuthError.value = error instanceof Error ? error.message : 'Unauthorized design access'
    throw error
  }
}

function activeDesignId(designId?: string): string {
  const resolved = designId ?? activeServerDesignId
  if (!resolved) throw new Error('No server design id is active')
  return resolved
}

export async function loadDesignFromServer(designId: string): Promise<void> {
  await waitForOpenPencilStore()
  await ensureDesignAuth(designId)
  const response = await fetch(`${OPENPENCIL_SERVER_URL}/api/v1/design/${designId}?format=json`, {
    credentials: 'include'
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(errorMessage(body, `Load failed with ${response.status}`))
  }
  if (typeof body !== 'object' || body === null || !('dataBase64' in body)) {
    throw new Error('Design load returned an invalid response')
  }
  const dataBase64 = body.dataBase64
  if (typeof dataBase64 !== 'string') throw new Error('Design load returned invalid data')

  const binary = atob(dataBase64)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  const file = new File([bytes], `${designId}.fig`, { type: 'application/octet-stream' })
  const { openFileInNewTab } = await import('@/app/tabs')
  await openFileInNewTab(file)
}

async function saveDesignToServerNow(designId: string): Promise<void> {
  await waitForOpenPencilStore()
  if (designPermission.value !== 'write') {
    throw new Error('This design URL does not allow saving changes')
  }
  const store = window.openPencil?.getStore?.()
  if (!store) throw new Error('window.openPencil.getStore() returned no editor store')
  const bytes = await store.getFigFile()
  const response = await fetch(`${OPENPENCIL_SERVER_URL}/api/v1/design/${designId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Blob([bytes], { type: 'application/octet-stream' })
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(errorMessage(body, `Save failed with ${response.status}`))
  }
}

export async function saveDesignToServer(designId?: string): Promise<void> {
  const resolved = activeDesignId(designId)
  activeServerDesignId = resolved
  await saveDesignToServerNow(resolved)
}

export function saveDesignToServerDebounced(designId?: string): Promise<void> {
  const resolved = activeDesignId(designId)
  activeServerDesignId = resolved
  const currentTimer = pendingSaveTimers.get(resolved)
  if (currentTimer) clearTimeout(currentTimer)

  return new Promise<void>((resolve, reject) => {
    const requests = pendingSaveRequests.get(resolved) ?? []
    requests.push({ resolve, reject })
    pendingSaveRequests.set(resolved, requests)
    pendingSaveTimers.set(
      resolved,
      setTimeout(
        () => {
          pendingSaveTimers.delete(resolved)
          void saveDesignToServerNow(resolved)
            .then(() => {
              const pending = pendingSaveRequests.get(resolved) ?? []
              pendingSaveRequests.delete(resolved)
              pending.forEach((request) => request.resolve())
            })
            .catch((error: unknown) => {
              const pending = pendingSaveRequests.get(resolved) ?? []
              pendingSaveRequests.delete(resolved)
              pending.forEach((request) => request.reject(error))
            })
        },
        Math.max(0, OPENPENCIL_SERVER_SAVE_DEBOUNCE_MS)
      )
    )
  })
}

export function installServerBridgeAutosave(): void {
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
          if (!activeServerDesignId || !store.state.autosaveEnabled) return
          void store.saveFigFile().catch((error: unknown) => {
            console.error('[server-bridge] autosave failed:', error)
          })
        }
      )
    },
    { immediate: true }
  )
}

export function installServerBridgeAutoload(): void {
  const designId = new URLSearchParams(window.location.search).get('design')
  if (!designId) return
  activeServerDesignId = designId
  void loadDesignFromServer(designId).catch((error: unknown) => {
    console.error('[server-bridge] failed to load design:', error)
    designAuthStatus.value = 'unauth'
    designAuthError.value = error instanceof Error ? error.message : 'Failed to load design'
  })
}

window.openPencilServer = {
  load: loadDesignFromServer,
  save: saveDesignToServer,
  saveDebounced: saveDesignToServerDebounced
}
