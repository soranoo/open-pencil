<script setup lang="ts">
import CollabAvatarStack from '@/components/CollabPanel/CollabAvatarStack.vue'
import CollabSharePopover from '@/components/CollabPanel/CollabSharePopover.vue'
import { provideCollabPanel } from '@/components/CollabPanel/context'
import { IS_DISABLE_COLLABORATION } from '@/constants'

const isCollaborationEnabled = !IS_DISABLE_COLLABORATION

if (isCollaborationEnabled) {
  provideCollabPanel()
}
</script>

<template>
  <div v-if="isCollaborationEnabled" class="flex w-full items-center justify-end gap-2">
    <CollabAvatarStack />
    <div class="flex-1" />
    <CollabSharePopover />
  </div>
</template>
