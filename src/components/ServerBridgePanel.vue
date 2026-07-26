<!--
  NEW FILE — optional. Drop in at: src/components/ServerBridgePanel.vue

  A minimal floating panel wrapping window.openPencilServer, for people who'd rather
  click buttons than open devtools. Deliberately NOT wired into the app's existing menu
  system (src/app/shell/menu/*) — that would need tracing how that registry works in
  detail first. Mount this independently in App.vue if you want it:

    import ServerBridgePanel from '@/components/ServerBridgePanel.vue'
    <ServerBridgePanel />  (add next to <RouterView /> in src/App.vue)
-->
<script setup lang="ts">
import { ref } from 'vue'

const designId = ref('')
const prompt = ref('')
const status = ref('')

async function onLoad() {
  status.value = 'Loading…'
  try {
    await window.openPencilServer?.load(designId.value)
    status.value = 'Loaded.'
  } catch (e) {
    status.value = `Load failed: ${(e as Error).message}`
  }
}

async function onSave() {
  if (!designId.value) {
    status.value = 'Enter a design id first (or generate one below).'
    return
  }
  status.value = 'Saving…'
  try {
    await window.openPencilServer?.save(designId.value)
    status.value = 'Saved.'
  } catch (e) {
    status.value = `Save failed: ${(e as Error).message}`
  }
}

async function onGenerate() {
  status.value = 'Generating…'
  try {
    const result = await window.openPencilServer?.generate(prompt.value, designId.value || undefined)
    if (result) {
      designId.value = result.designId
      status.value = result.summary
    }
  } catch (e) {
    status.value = `Generate failed: ${(e as Error).message}`
  }
}
</script>

<template>
  <div class="server-bridge-panel">
    <input v-model="designId" placeholder="design id (uuid)" />
    <textarea v-model="prompt" placeholder="Describe what to generate…" rows="2" />
    <div class="server-bridge-panel__actions">
      <button @click="onGenerate">Generate</button>
      <button @click="onLoad">Load</button>
      <button @click="onSave">Save</button>
    </div>
    <p v-if="status" class="server-bridge-panel__status">{{ status }}</p>
  </div>
</template>

<style scoped>
.server-bridge-panel {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 9999;
  width: 260px;
  padding: 12px;
  border-radius: 8px;
  background: var(--op-surface, #1e1e1e);
  color: var(--op-text, #eee);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
}
.server-bridge-panel input,
.server-bridge-panel textarea {
  width: 100%;
  box-sizing: border-box;
  font-size: 12px;
}
.server-bridge-panel__actions {
  display: flex;
  gap: 6px;
}
.server-bridge-panel__status {
  margin: 0;
  opacity: 0.8;
  word-break: break-word;
}
</style>
