import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import type { ThemeDefinition, ThemeId, ThemeStateSnapshot } from '@aide/shared'

const FALLBACK_THEMES: ThemeDefinition[] = [
  { id: 'one-dark', label: 'One Dark', appearance: 'dark', tokens: {}, source: 'builtin' },
  { id: 'one-light', label: 'One Light', appearance: 'light', tokens: {}, source: 'builtin' },
]

const FALLBACK_SNAPSHOT: ThemeStateSnapshot = {
  themes: FALLBACK_THEMES,
  activeThemeId: 'one-dark',
  defaultDarkThemeId: 'one-dark',
  defaultLightThemeId: 'one-light',
}

function getActiveTheme(snapshot: ThemeStateSnapshot): ThemeDefinition {
  return (
    snapshot.themes.find((theme) => theme.id === snapshot.activeThemeId) ??
    snapshot.themes[0] ??
    FALLBACK_THEMES[0]
  )
}

function applyThemeTokens(theme: ThemeDefinition, previousKeys: Set<string>) {
  const root = document.documentElement
  const nextKeys = new Set(Object.keys(theme.tokens))
  for (const key of previousKeys) {
    if (!nextKeys.has(key)) {
      root.style.removeProperty(key)
    }
  }
  for (const [key, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(key, value)
  }
  root.setAttribute('data-theme', theme.id)
  return nextKeys
}

interface ThemeContextValue {
  theme: ThemeDefinition
  themes: ThemeDefinition[]
  activeThemeId: ThemeId
  defaultDarkThemeId: ThemeId
  defaultLightThemeId: ThemeId
  setTheme: (themeId: ThemeId) => Promise<void>
  setDefaultDarkTheme: (themeId: ThemeId) => Promise<void>
  setDefaultLightTheme: (themeId: ThemeId) => Promise<void>
  reloadThemes: () => Promise<void>
  openThemesDirectory: () => Promise<void>
  toggleTheme: () => Promise<void>
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ThemeStateSnapshot>(FALLBACK_SNAPSHOT)
  const previousTokenKeysRef = useRef<Set<string>>(new Set())

  const applySnapshot = useCallback((nextSnapshot: ThemeStateSnapshot) => {
    setSnapshot(nextSnapshot)
    previousTokenKeysRef.current = applyThemeTokens(
      getActiveTheme(nextSnapshot),
      previousTokenKeysRef.current,
    )
  }, [])

  useEffect(() => {
    let mounted = true

    window.api
      .getThemeState()
      .then((nextSnapshot) => {
        if (!mounted) return
        applySnapshot(nextSnapshot)
      })
      .catch((err) => {
        console.warn('Failed to load theme state, using fallback theme:', err)
        applySnapshot(FALLBACK_SNAPSHOT)
      })

    const cleanup = window.api.onThemeChanged((nextSnapshot) => {
      if (!mounted) return
      applySnapshot(nextSnapshot)
    })

    return () => {
      mounted = false
      cleanup()
    }
  }, [applySnapshot])

  const theme = useMemo(() => getActiveTheme(snapshot), [snapshot])

  const setTheme = useCallback(async (themeId: ThemeId) => {
    await window.api.setTheme(themeId)
  }, [])

  const setDefaultDarkTheme = useCallback(async (themeId: ThemeId) => {
    await window.api.setDefaultDarkTheme(themeId)
  }, [])

  const setDefaultLightTheme = useCallback(async (themeId: ThemeId) => {
    await window.api.setDefaultLightTheme(themeId)
  }, [])

  const reloadThemes = useCallback(async () => {
    const nextSnapshot = await window.api.reloadThemes()
    applySnapshot(nextSnapshot)
  }, [applySnapshot])

  const openThemesDirectory = useCallback(async () => {
    await window.api.openThemesDirectory()
  }, [])

  const toggleTheme = useCallback(async () => {
    const nextThemeId =
      theme.appearance === 'dark' ? snapshot.defaultLightThemeId : snapshot.defaultDarkThemeId
    await window.api.setTheme(nextThemeId)
  }, [snapshot.defaultDarkThemeId, snapshot.defaultLightThemeId, theme.appearance])

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      themes: snapshot.themes,
      activeThemeId: snapshot.activeThemeId,
      defaultDarkThemeId: snapshot.defaultDarkThemeId,
      defaultLightThemeId: snapshot.defaultLightThemeId,
      setTheme,
      setDefaultDarkTheme,
      setDefaultLightTheme,
      reloadThemes,
      openThemesDirectory,
      toggleTheme,
    }),
    [
      theme,
      snapshot.themes,
      snapshot.activeThemeId,
      snapshot.defaultDarkThemeId,
      snapshot.defaultLightThemeId,
      setTheme,
      setDefaultDarkTheme,
      setDefaultLightTheme,
      reloadThemes,
      openThemesDirectory,
      toggleTheme,
    ],
  )

  return createElement(ThemeContext.Provider, { value }, children)
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
