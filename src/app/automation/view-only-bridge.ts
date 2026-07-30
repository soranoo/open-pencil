import { ref, watch, type Ref } from 'vue'
import type { Router } from 'vue-router'

import { useActiveEditorStoreRef } from '@/app/editor/active-store'

type AnyStore = Record<string, any>

type Patched = {
  key: string
  original: any
}

export const isReadOnly = ref(false)
export const serverReadOnly = ref(false)

/**
 * Install a view-only UI "bridge" that toggles read-only behavior based on the
 * router query param `view=readonly`.
 *
 * Usage (main.ts):
 *   import { createRouter, ... } from 'vue-router'
 *   const router = createRouter(...)
 *   installViewOnlyBridge(router)
 */
export function installViewOnlyBridge(router: Router) {
  const storeRef = useActiveEditorStoreRef()
  let activeStore: AnyStore | null = null
  let patchedMethods: Patched[] = []

  // List of store method names to guard in read-only mode.
  // Add more method names here if you find other common mutating entrypoints.
  const METHODS_TO_GUARD = [
    'setTool', // tool switching
    'saveFigFile',
    'saveFigFileAs',
    'exportSelection'
    // you can add: 'createShape', 'importDOMText', 'openFigFile' etc if needed
  ]

  function applyReadOnlyToStore(store: AnyStore, enable: boolean) {
    if (!store) return

    isReadOnly.value = enable

    if (enable) {
      // Set flags in reactive state to hide UI and mark readonly
      try {
        if (store.state) {
          store.state.readOnly = true
          // hide UI panels (many components use store.state.showUI)
          store.state.showUI = false
        }
      } catch (e) {
        console.warn('[view-only] failed to set store state flags', e)
      }

      // Force HAND tool (allow panning)
      try {
        // prefer store.setTool if available
        if (typeof store.setTool === 'function') {
          store.setTool('HAND')
        } else if (typeof store.setActiveTool === 'function') {
          store.setActiveTool('HAND')
        } else if (store.state) {
          store.state.activeTool = 'HAND'
        }
      } catch (e) {
        /* noop */
      }

      // Monkeypatch selected methods to no-op in readonly (except allow HAND)
      patchedMethods = []
      for (const m of METHODS_TO_GUARD) {
        const original = (store as AnyStore)[m]
        if (!original || typeof original !== 'function') continue
        const wrapper = function (this: AnyStore, ...args: unknown[]) {
          try {
            // If readOnly is toggled on, block mutating calls
            if (this?.state?.readOnly) {
              // allow setTool('HAND') so panning still works
              if (m === 'setTool' && args.length > 0 && args[0] === 'HAND') {
                return original.apply(this, args)
              }
              // silently ignore and optionally log for debugging
              // console.debug(`[view-only] blocked store.${m} while readOnly`)
              return
            }
          } catch {
            // if anything goes wrong, be conservative and block
            return
          }
          return original.apply(this, args)
        }
        // keep reference for restore
        patchedMethods.push({ key: m, original })
        ;(store as AnyStore)[m] = wrapper
      }
    } else {
      // disable: restore originals and unset flags
      for (const { key, original } of patchedMethods) {
        try {
          ;(store as AnyStore)[key] = original
        } catch {
          /* ignore */
        }
      }
      patchedMethods = []
      try {
        if (store.state) {
          store.state.readOnly = false
          // restore UI visibility; leave decision to app - default to true
          store.state.showUI = true
        }
      } catch {
        /* ignore */
      }
      console.info('[view-only] disabled')
    }
  }

  // watch the active store ref so we can patch it when the editor mounts
  watch(
    () => storeRef.value,
    (next) => {
      if (!next) {
        activeStore = null
        return
      }
      activeStore = next as AnyStore

      // If route currently requests readonly, apply it now
      if (serverReadOnly.value) {
        applyReadOnlyToStore(activeStore, true)
      } else {
        applyReadOnlyToStore(activeStore, false)
      }
    },
    { immediate: true }
  )

  // watch route changes to toggle readonly mode
  watch(
    () => router.currentRoute,
    (routeRef) => {
      const want = serverReadOnly.value
      if (activeStore) {
        applyReadOnlyToStore(activeStore, want)
      } else {
        // If store not yet mounted, it will be applied when storeRef changes
        isReadOnly.value = want
      }
    },
    { immediate: true, deep: true }
  )

  watch(
    serverReadOnly,
    (want) => {
      const nextReadOnly = want
      if (activeStore) {
        applyReadOnlyToStore(activeStore, nextReadOnly)
      } else {
        isReadOnly.value = nextReadOnly
      }
    },
    { immediate: true }
  )
}
