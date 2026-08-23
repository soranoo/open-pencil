import { computed, shallowRef, type ComputedRef } from 'vue'

import { appPreferences, updateRecoveryEnabled } from '@/app/settings/preferences/store'
import { IS_DISABLE_LOCAL_UNSAVED_WORK } from '@/app/config/frontend-env'

const runtimeOverride = shallowRef<boolean | null>(null)

export const recoveryEnabled: ComputedRef<boolean> = computed(
  () => {
    if (IS_DISABLE_LOCAL_UNSAVED_WORK) return false
    return runtimeOverride.value ?? appPreferences.value.recovery.enabled
  }
)

export function setRecoveryEnabled(enabled: boolean): void {
  updateRecoveryEnabled(enabled)
}

export function setRecoveryRuntimeOverride(enabled: boolean | null): void {
  runtimeOverride.value = enabled
}
