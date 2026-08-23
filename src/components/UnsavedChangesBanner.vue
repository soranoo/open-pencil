<script setup lang="ts">
import { computed } from 'vue'
import { isSaving } from '@/app/document/io/save'
import { toast } from '@/app/shell/ui'

import { useEditorStore } from '@/app/editor/active-store'
import { designPermission } from '@/app/automation/server-bridge'

const store = useEditorStore()

const hasUnsavedChanges = computed(() => {
  void store.state.sceneVersion
  return store.hasUnsavedChanges()
})

const show = computed(() => !store.state.autosaveEnabled && hasUnsavedChanges.value)

async function saveNow() {
  try {
    await store.saveFigFile()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}
</script>

<template>
  <div
    v-if="show && designPermission === 'write'"
    data-test-id="unsaved-banner"
    class="flex items-center gap-2 border-b border-warning-border bg-warning-bg px-3 py-1.5 text-xs text-warning-text"
  >
    <span class="flex-1">
      You have unsaved changes while auto-save is off. Use Save to persist this document.
    </span>
    <button
      data-test-id="unsaved-banner-save"
      class="shrink-0 rounded px-1.5 py-0.5 font-medium text-warning-action transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60 border border-warning-action"
      :disabled="isSaving"
      @click="saveNow"
    >
      {{ isSaving ? 'Saving...' : 'Save now' }}
    </button>
  </div>
</template>
