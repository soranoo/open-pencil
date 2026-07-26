/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vanillajs" />
/// <reference types="unplugin-icons/types/vue" />

declare const __OPENPENCIL_APP_VERSION__: string
declare const __OPENPENCIL_LOCAL_AUTOMATION_TOKEN__: string | null

interface ImportMetaEnv {
  readonly VITE_OPENPENCIL_SERVER_URL: string
  readonly VITE_OPENPENCIL_AUTOSAVE: 'true' | 'false'
  readonly VITE_OPENPENCIL_SERVER_SAVE_DEBOUNCE_MS: string
  readonly VITE_DISABLE_TAB: 'true' | 'false'

  /**
   * Backend mode toggle. Set to 'true' to use backend-only save flow.
   */
  readonly VITE_IS_BACKEND_MODE?: 'true' | 'false'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
