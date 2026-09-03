export const OPENPENCIL_SERVER_URL =
  import.meta.env.VITE_OPENPENCIL_SERVER_URL ?? 'http://localhost:8787'

export const OPENPENCIL_SERVER_SAVE_DEBOUNCE_MS = Number(
  import.meta.env.VITE_OPENPENCIL_SERVER_SAVE_DEBOUNCE_MS ?? 1200
)

export const AUTOSAVE_ENABLED_BY_DEFAULT = import.meta.env.VITE_OPENPENCIL_AUTOSAVE === 'true'
export const IS_DISABLE_LOCAL_UNSAVED_WORK =
  import.meta.env.VITE_DISABLE_LOCAL_UNSAVED_WORK === 'true'
export const IS_DISABLE_SETTINGS_MODAL = import.meta.env.VITE_DISABLE_SETTINGS_MODAL === 'true'
export const IS_BACKEND_MODE = import.meta.env.VITE_IS_BACKEND_MODE === 'true'
export const IS_DISABLE_TAB = import.meta.env.VITE_DISABLE_TAB === 'true'
export const IS_DISABLE_COLLABORATION = import.meta.env.VITE_DISABLE_COLLABORATION === 'true'
export const IS_DISABLE_UI_CODE_TAB = import.meta.env.VITE_DISABLE_UI_CODE_TAB === 'true'
export const IS_DISABLE_AI_CHAT = import.meta.env.VITE_DISABLE_AI_CHAT === 'true'
