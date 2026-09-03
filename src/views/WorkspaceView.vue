<script setup lang="ts">
import { onMounted, onUnmounted, provide, ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { useHead } from '@unhead/vue'
import { useRoute } from 'vue-router'

import { exposeCollaborationActions } from '@/app/browser-bridge'
import { appRuntimeConfig } from '@/app/runtime/config'
import { startMCPRuntime, stopMCPRuntime } from '@/app/automation/mcp/runtime'
import { COLLAB_KEY, useCollab } from '@/app/collab/use'
import { createDemoShapes } from '@/app/demo/document'
import { useKeyboard } from '@/app/shell/keyboard/use'
import { openFileFromPath, useEditorMenu } from '@/app/shell/menu/use'
import {
  activeTab,
  createDocumentInCurrentTab,
  createHomeTab,
  createTab,
  getActiveStore,
  tabCount
} from '@/app/tabs'
import { isTauri } from '@/app/tauri/env'
import FontStatusBanner from '@/components/font-status/FontStatusBanner.vue'
import CommandPalette from '@/components/commands/CommandPalette.vue'
import SafariBanner from '@/components/SafariBanner.vue'
import TabBar from '@/components/TabBar.vue'
import RenameSelectionDialog from '@/components/selection/RenameSelectionDialog.vue'
import EditorWorkspace from '@/components/editor/EditorWorkspace.vue'
import HomeWorkspace from '@/components/home/HomeWorkspace.vue'
import { connectRemoteControl } from '@/app/automation/remote-control'
import { IS_BACKEND_MODE, IS_DISABLE_TAB } from '@/app/config/frontend-env'
import { designAuthError, designAuthStatus } from '@/app/automation/server-bridge'
import UnsavedChangesBanner from '@/components/UnsavedChangesBanner.vue'
import ReadOnlyBanner from '@/components/ReadOnlyBanner.vue'

const route = useRoute()
const createdInitialTab = tabCount() === 0
const shouldCreateHome =
  route.path === '/' &&
  !appRuntimeConfig.test &&
  !route.meta.demo &&
  (isTauri() || appRuntimeConfig.recentFiles)
let firstTab = activeTab.value
if (!firstTab) firstTab = shouldCreateHome ? createHomeTab() : createTab()

if (createdInitialTab && route.meta.demo && !appRuntimeConfig.test) {
  void createDemoShapes(firstTab.store)
}

useHead({ title: route.meta.demo ? 'Demo' : undefined })
useKeyboard()
useEditorMenu()

const collab = useCollab(getActiveStore)
provide(COLLAB_KEY, collab)
exposeCollaborationActions(collab)

useEventListener(
  document,
  'wheel',
  (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) event.preventDefault()
  },
  { passive: false }
)

const fileAssociationCleanup = ref<(() => void) | null>(null)
const remoteControlCleanup = ref<(() => void) | null>(null)

interface PendingOpenFile {
  path: string
}

async function openPendingAssociatedFiles(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  const files = await invoke<PendingOpenFile[]>('take_pending_open')
  for (const file of files) await openFileFromPath(file.path)
}

async function bindAssociatedFileOpen(): Promise<void> {
  if (!isTauri()) return
  const { listen } = await import('@tauri-apps/api/event')
  fileAssociationCleanup.value = await listen('open-associated-files', () => {
    void openPendingAssociatedFiles().catch((error) => console.error('[Open With]', error))
  })
  await openPendingAssociatedFiles()
}

onMounted(async () => {
  await startMCPRuntime(getActiveStore)

  // Only connects when the page was opened with ?op-remote-control=1 (set by
  // the @open-pencil/automation package). No-op in normal interactive use.
  remoteControlCleanup.value = connectRemoteControl(params).disconnect

  try {
    await bindAssociatedFileOpen()
  } catch (error) {
    console.error('[Open With]', error)
  }
})

onUnmounted(() => {
  void stopMCPRuntime()
  fileAssociationCleanup.value?.()
  remoteControlCleanup.value?.()
})
</script>

<template>
  <div data-test-id="editor-root" class="flex h-screen w-screen flex-col">
    <div
      v-if="IS_BACKEND_MODE && designAuthStatus === 'authenticating'"
      class="flex flex-1 items-center justify-center bg-canvas px-6 text-center text-sm text-muted"
    >
      Authenticating design access...
    </div>
    <div
      v-else-if="IS_BACKEND_MODE && designAuthStatus === 'unauth'"
      class="flex flex-1 items-center justify-center bg-canvas px-6 text-center"
    >
      <div class="max-w-md rounded-xl border border-border bg-panel px-6 py-5 shadow-sm">
        <h1 class="text-base font-medium text-surface">Design access unavailable</h1>
        <p class="mt-2 text-sm text-muted">
          {{ designAuthError ? 'This design link is invalid, already used, or expired.' : '' }}
        </p>
      </div>
    </div>
    <template v-else>
      <SafariBanner />
      <FontStatusBanner v-if="!IS_BACKEND_MODE" />
      <RenameSelectionDialog />
      <CommandPalette />
      <TabBar />
      <UnsavedChangesBanner v-if="IS_BACKEND_MODE" />
      <ReadOnlyBanner v-if="IS_BACKEND_MODE" />

      <TabBar v-if="!IS_DISABLE_TAB" />
      <HomeWorkspace
        v-show="activeTab?.kind === 'home' && !IS_BACKEND_MODE"
        @new-document="createDocumentInCurrentTab"
      />
      <EditorWorkspace v-if="activeTab?.kind !== 'home'" />
    </template>
  </div>
</template>
