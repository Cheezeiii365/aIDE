import { useState, useEffect, useCallback } from 'react'
import type { KeybindingRule } from '@aide/shared'
import { loadKeybindings } from '../lib/KeybindingService'
import { defaultKeybindings } from '../lib/defaultKeybindings'

export interface UseKeybindingOverridesReturn {
  overrides: KeybindingRule[]
  loading: boolean
  addOverride: (rule: KeybindingRule) => Promise<void>
  removeOverride: (index: number) => Promise<void>
  resetOverrides: () => Promise<void>
}

export function useKeybindingOverrides(): UseKeybindingOverridesReturn {
  const [overrides, setOverrides] = useState<KeybindingRule[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.getKeybindingOverrides().then((loaded) => {
      setOverrides(loaded)
      loadKeybindings(defaultKeybindings, loaded)
      setLoading(false)
    })

    const unsub = window.api.onKeybindingsChanged((updated) => {
      setOverrides(updated)
      loadKeybindings(defaultKeybindings, updated)
    })
    return unsub
  }, [])

  const persist = useCallback(async (rules: KeybindingRule[]) => {
    await window.api.setKeybindingOverrides(rules)
  }, [])

  const addOverride = useCallback(async (rule: KeybindingRule) => {
    const updated = [...overrides, rule]
    await persist(updated)
  }, [overrides, persist])

  const removeOverride = useCallback(async (index: number) => {
    const updated = overrides.filter((_, i) => i !== index)
    await persist(updated)
  }, [overrides, persist])

  const resetOverrides = useCallback(async () => {
    await persist([])
  }, [persist])

  return { overrides, loading, addOverride, removeOverride, resetOverrides }
}
