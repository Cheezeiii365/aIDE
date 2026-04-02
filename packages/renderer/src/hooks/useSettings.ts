import { useState, useEffect, useCallback } from 'react'
import type { AideProjectSettings, ResolvedSettings, SettingsScope } from '@aide/shared'

export interface UseSettingsReturn {
  builtInDefaults: ResolvedSettings | null
  userSettings: Partial<AideProjectSettings> | null
  workspaceSettings: AideProjectSettings | null
  resolved: ResolvedSettings | null
  loading: boolean
  scope: SettingsScope
  setScope: (scope: SettingsScope) => void
  setValue: (key: string, value: unknown) => Promise<void>
  resetToDefault: (key: string) => Promise<void>
  isModified: (key: string) => boolean
  getEffectiveValue: (key: string) => unknown
  getScopeValue: (key: string) => unknown
}

/**
 * @param workspaceId - Workspace whose `.aide/settings.json` layer is read/written; when `null`, project settings are empty and resolved settings match user + built-in defaults only.
 */
export function useSettings(workspaceId: string | null): UseSettingsReturn {
  const [builtInDefaults, setBuiltInDefaults] = useState<ResolvedSettings | null>(null)
  const [userSettings, setUserSettings] = useState<Partial<AideProjectSettings> | null>(null)
  const [workspaceSettings, setWorkspaceSettings] = useState<AideProjectSettings | null>(null)
  const [resolved, setResolved] = useState<ResolvedSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState<SettingsScope>('user')

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [defaults, user, workspace, res] = await Promise.all([
        window.api.getBuiltInDefaults(),
        window.api.getUserSettings(),
        workspaceId ? window.api.getWorkspaceSettings(workspaceId) : Promise.resolve({} as AideProjectSettings),
        workspaceId ? window.api.getResolvedSettings(workspaceId) : window.api.getResolvedSettings(null),
      ])

      if (cancelled) return
      setBuiltInDefaults(defaults)
      setUserSettings(user)
      setWorkspaceSettings(workspace)
      setResolved(res)
      setLoading(false)
    }

    void load()
    return () => { cancelled = true }
  }, [workspaceId])

  useEffect(() => {
    const unsub = window.api.onSettingsChanged(() => {
      window.api.getUserSettings().then(setUserSettings)
      if (workspaceId) {
        window.api.getWorkspaceSettings(workspaceId).then(setWorkspaceSettings)
        window.api.getResolvedSettings(workspaceId).then(setResolved)
      } else {
        setWorkspaceSettings({})
        window.api.getResolvedSettings(null).then(setResolved)
      }
    })
    return unsub
  }, [workspaceId])

  const setValue = useCallback(async (key: string, value: unknown) => {
    if (scope === 'user') {
      setUserSettings((prev) => prev ? { ...prev, [key]: value } : { [key]: value })
      await window.api.setUserSetting(key, value)
    } else {
      if (!workspaceId) return
      setWorkspaceSettings((prev) => prev ? { ...prev, [key]: value } : { [key]: value })
      await window.api.setWorkspaceSetting(key, value, workspaceId)
    }
  }, [scope, workspaceId])

  const resetToDefault = useCallback(async (key: string) => {
    if (scope === 'user') {
      setUserSettings((prev) => {
        if (!prev) return prev
        const next = Object.fromEntries(
          Object.entries(prev as Record<string, unknown>).filter(([entryKey]) => entryKey !== key),
        )
        return next
      })
      await window.api.setUserSetting(key, undefined)
    } else {
      if (!workspaceId) return
      setWorkspaceSettings((prev) => {
        if (!prev) return prev
        const next = Object.fromEntries(
          Object.entries(prev as Record<string, unknown>).filter(([entryKey]) => entryKey !== key),
        )
        return next
      })
      await window.api.setWorkspaceSetting(key, undefined, workspaceId)
    }
  }, [scope, workspaceId])

  const isModified = useCallback((key: string): boolean => {
    if (!builtInDefaults) return false
    const layerValues = scope === 'user' ? userSettings : workspaceSettings
    if (!layerValues) return false
    return key in layerValues && (layerValues as Record<string, unknown>)[key] !== undefined
  }, [scope, userSettings, workspaceSettings, builtInDefaults])

  const getEffectiveValue = useCallback((key: string): unknown => {
    if (!resolved) return undefined
    return resolved[key as keyof ResolvedSettings]
  }, [resolved])

  const getScopeValue = useCallback((key: string): unknown => {
    const layerValues = scope === 'user' ? userSettings : workspaceSettings
    if (!layerValues) return undefined
    const val = (layerValues as Record<string, unknown>)[key]
    if (val !== undefined) return val
    if (!resolved) return undefined
    return resolved[key as keyof ResolvedSettings]
  }, [scope, userSettings, workspaceSettings, resolved])

  return {
    builtInDefaults,
    userSettings,
    workspaceSettings,
    resolved,
    loading,
    scope,
    setScope,
    setValue,
    resetToDefault,
    isModified,
    getEffectiveValue,
    getScopeValue,
  }
}
