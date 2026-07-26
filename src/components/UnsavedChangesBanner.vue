<script setup lang="ts">
import { computed, ref } from 'vue'
import { isSaving } from '@/app/document/io/save'

import { useEditorStore } from '@/app/editor/active-store'

const store = useEditorStore()
const saveError = ref<string | null>(null)

const hasUnsavedChanges = computed(() => {
  void store.state.sceneVersion
  return store.hasUnsavedChanges()
})

const show = computed(() => !store.state.autosaveEnabled && hasUnsavedChanges.value)

async function saveNow() {
  saveError.value = null
  try {
    await store.saveFigFile()
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : String(error)
  }
}
</script>

<template>
  <div
    v-if="show"
    data-test-id="unsaved-banner"
    class="flex items-center gap-2 border-b border-warning-border bg-warning-bg px-3 py-1.5 text-xs text-warning-text"
  >
    <span class="flex-1">
      You have unsaved changes while auto-save is off. Use Save to persist this document.
      <span v-if="saveError" class="ml-1 text-(--color-danger)">Save failed: {{ saveError }}</span>
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
