import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { ThemeName } from '@aide/shared'
import { createElement, type ReactNode } from 'react'

interface ThemeContextValue {
  theme: ThemeName
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>('one-dark')

  useEffect(() => {
    // Load persisted theme from main process
    window.api.getTheme().then((t) => {
      setTheme(t)
      document.documentElement.setAttribute('data-theme', t)
    })

    // Listen for theme changes from main process
    const cleanup = window.api.onThemeChanged((t) => {
      setTheme(t)
      document.documentElement.setAttribute('data-theme', t)
    })

    return cleanup
  }, [])

  const toggleTheme = useCallback(() => {
    const next: ThemeName = theme === 'one-dark' ? 'one-light' : 'one-dark'
    document.documentElement.setAttribute('data-theme', next)
    setTheme(next)
    window.api.setTheme(next)
  }, [theme])

  return createElement(ThemeContext.Provider, { value: { theme, toggleTheme } }, children)
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
