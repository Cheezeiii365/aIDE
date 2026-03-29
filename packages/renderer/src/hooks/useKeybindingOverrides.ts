import { useState, useEffect, useCallback } from 'react'
import type { KeybindingRule } from '@aide/shared'
import { loadKeybindings } from '../commands/KeybindingService'
import { defaultKeybindings } from '../commands/defaultKeybindings'

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
    const current = await window.api.getKeybindingOverrides()
    await persist([...current, rule])
  }, [persist])

  const removeOverride = useCallback(async (index: number) => {
    const current = await window.api.getKeybindingOverrides()
    await persist(current.filter((_, i) => i !== index))
  }, [persist])

  const resetOverrides = useCallback(async () => {
    await persist([])
  }, [persist])

  return { overrides, loading, addOverride, removeOverride, resetOverrides }
}
