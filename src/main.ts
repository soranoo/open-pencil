import { createHead } from '@unhead/vue/client'
import { createApp } from 'vue'

import './app.css'
import {
  installServerBridgeAutoload,
  installServerBridgeAutosave
} from '@/app/automation/server-bridge'
import { IS_BACKEND_MODE } from '@/app/config/frontend-env'
import { preloadFonts } from '@/app/editor/fonts'
import { IS_TAURI } from '@/constants'

import App from './App.vue'
import router from './router'

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
