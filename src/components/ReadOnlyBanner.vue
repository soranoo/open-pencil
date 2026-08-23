<script setup lang="ts">
import { designPermission } from '@/app/automation/server-bridge'
</script>

<template>
  <div
    v-if="designPermission === 'read'"
    data-test-id="unsaved-banner"
    class="flex items-center gap-2 border-b border-warning-border bg-warning-bg px-3 py-1.5 text-xs text-warning-text"
  >
    <span class="flex-1">
      You are in read-only mode. You cannot make changes to this document.
    </span>
  </div>
</template>
