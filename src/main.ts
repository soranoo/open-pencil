import { createHead } from '@unhead/vue/client'
import { createApp } from 'vue'

import './app.css'
import { preloadFonts } from '@/app/editor/fonts'
import { IS_BACKEND_MODE, IS_TAURI } from '@/constants'

import App from './App.vue'
import router from './router'

// NEW — headless-server bridge (see src/app/automation/server-bridge.ts). This wires up
// window.openPencilServer.{load,save,generate} and auto-loads ?designId=<uuid> if present.
// Safe no-op if you never navigate with that query param.
import { installServerBridgeAutoload, installServerBridgeAutosave } from '@/app/automation/server-bridge'

preloadFonts()
const head = createHead()
createApp(App).use(router).use(head).mount('#app')

if (IS_BACKEND_MODE) {
  installServerBridgeAutoload()
  installServerBridgeAutosave()
}

if (!IS_TAURI) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true })
    return undefined
  })
}
