export type ThemeId = string

export type ThemeAppearance = 'dark' | 'light'

export interface ThemeManifest {
  id: ThemeId
  label: string
  appearance: ThemeAppearance
  tokens: Record<string, string>
  description?: string
  author?: string
}

export interface ThemeDefinition extends ThemeManifest {
  source: 'builtin' | 'user'
  path?: string
}

export interface ThemeStateSnapshot {
  themes: ThemeDefinition[]
  activeThemeId: ThemeId
  defaultDarkThemeId: ThemeId
  defaultLightThemeId: ThemeId
}
