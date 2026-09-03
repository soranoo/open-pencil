<script setup lang="ts">
import CollabAvatarStack from '@/components/CollabPanel/CollabAvatarStack.vue'
import CollabSharePopover from '@/components/CollabPanel/CollabSharePopover.vue'
import { provideCollabPanel } from '@/components/CollabPanel/context'
import { IS_DISABLE_COLLABORATION } from '@/app/config/frontend-env'

if (!IS_DISABLE_COLLABORATION) {
  provideCollabPanel()
}
</script>

<template>
  <div v-if="!IS_DISABLE_COLLABORATION" class="flex w-full items-center justify-end gap-2">
    <CollabAvatarStack />
    <div class="flex-1" />
    <CollabSharePopover />
  </div>
</template>
