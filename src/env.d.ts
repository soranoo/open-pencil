/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vanillajs" />
/// <reference types="unplugin-icons/types/vue" />

declare const __OPENPENCIL_APP_VERSION__: string
declare const __OPENPENCIL_LOCAL_AUTOMATION_TOKEN__: string | null
declare const __OPENPENCIL_LOCAL_AUTOMATION_URL__: string
declare const __OPENPENCIL_LOCAL_AUTOMATION_HTTP_URL__: string

interface ImportMetaEnv {
  readonly VITE_OPENPENCIL_SERVER_URL?: string
  readonly VITE_OPENPENCIL_AUTOSAVE?: 'true' | 'false'
  readonly VITE_DISABLE_LOCAL_UNSAVED_WORK?: 'true' | 'false'
  readonly VITE_DISABLE_SETTINGS_MODAL?: 'true' | 'false'
  readonly VITE_OPENPENCIL_SERVER_SAVE_DEBOUNCE_MS?: string
  readonly VITE_IS_BACKEND_MODE?: 'true' | 'false'
  readonly VITE_DISABLE_TAB?: 'true' | 'false'
  readonly VITE_DISABLE_COLLABORATION?: 'true' | 'false'
  readonly VITE_DISABLE_UI_CODE_TAB?: 'true' | 'false'
  readonly VITE_DISABLE_AI_CHAT?: 'true' | 'false'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
