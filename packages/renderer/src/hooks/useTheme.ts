import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { ThemeName } from '@aide/shared'
import { createElement, type ReactNode } from 'react'

const VALID_THEMES: ThemeName[] = ['one-dark', 'one-light']
const DEFAULT_THEME: ThemeName = 'one-dark'

function isValidTheme(value: unknown): value is ThemeName {
  return typeof value === 'string' && VALID_THEMES.includes(value as ThemeName)
}

function applyTheme(theme: ThemeName) {
  document.documentElement.setAttribute('data-theme', theme)
}

interface ThemeContextValue {
  theme: ThemeName
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>(DEFAULT_THEME)

  useEffect(() => {
    // Load persisted theme from main process
    window.api
      .getTheme()
      .then((t) => {
        const validated = isValidTheme(t) ? t : DEFAULT_THEME
        setTheme(validated)
        applyTheme(validated)
      })
      .catch((err) => {
        console.warn('Failed to load persisted theme, using default:', err)
        applyTheme(DEFAULT_THEME)
      })

    // Listen for theme changes from main process
    const cleanup = window.api.onThemeChanged((t) => {
      if (!isValidTheme(t)) return
      setTheme(t)
      applyTheme(t)
    })

    return cleanup
  }, [])

  const toggleTheme = useCallback(() => {
    const next: ThemeName = theme === 'one-dark' ? 'one-light' : 'one-dark'
    applyTheme(next)
    setTheme(next)
    window.api.setTheme(next).catch((err) => {
      console.warn('Failed to persist theme:', err)
    })
  }, [theme])

  return createElement(ThemeContext.Provider, { value: { theme, toggleTheme } }, children)
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
