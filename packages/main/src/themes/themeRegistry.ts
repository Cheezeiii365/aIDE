import { app, shell } from 'electron'
import { existsSync } from 'fs'
import { mkdir, readdir, readFile } from 'fs/promises'
import { join } from 'path'
import type Store from 'electron-store'
import type {
  AppSettings,
  ThemeAppearance,
  ThemeDefinition,
  ThemeId,
  ThemeManifest,
  ThemeStateSnapshot,
} from '@aide/shared'
import { builtInThemeManifests } from './builtins'

const BUILTIN_THEME_MANIFESTS = builtInThemeManifests as ThemeManifest[]
const BUILTIN_THEME_IDS = {
  dark: 'one-dark',
  light: 'one-light',
} as const satisfies Record<ThemeAppearance, ThemeId>

function normalizeTokens(tokens: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(tokens)) {
    if (key.startsWith('--') && typeof value === 'string' && value.trim().length > 0) {
      normalized[key] = value
    }
  }
  return normalized
}

function isAppearance(value: unknown): value is ThemeAppearance {
  return value === 'dark' || value === 'light'
}

function normalizeManifest(
  input: unknown,
  source: 'builtin' | 'user',
  filePath?: string,
): ThemeDefinition | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  if (typeof raw.id !== 'string' || raw.id.trim().length === 0) return null
  if (typeof raw.label !== 'string' || raw.label.trim().length === 0) return null
  if (!isAppearance(raw.appearance)) return null
  if (!raw.tokens || typeof raw.tokens !== 'object') return null

  const tokens = normalizeTokens(raw.tokens as Record<string, unknown>)
  if (Object.keys(tokens).length === 0) return null

  return {
    id: raw.id.trim(),
    label: raw.label.trim(),
    appearance: raw.appearance,
    tokens,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    author: typeof raw.author === 'string' ? raw.author : undefined,
    source,
    path: filePath,
  }
}

function dedupeThemes(themes: ThemeDefinition[]): ThemeDefinition[] {
  const seen = new Set<string>()
  const deduped: ThemeDefinition[] = []
  for (const theme of themes) {
    if (seen.has(theme.id)) continue
    seen.add(theme.id)
    deduped.push(theme)
  }
  return deduped
}

function fallbackThemeIdForAppearance(appearance: ThemeAppearance): ThemeId {
  return BUILTIN_THEME_IDS[appearance]
}

function themeMap(themes: ThemeDefinition[]): Map<string, ThemeDefinition> {
  return new Map(themes.map((theme) => [theme.id, theme]))
}

function resolveThemeTokens(
  theme: ThemeDefinition,
  byId: Map<string, ThemeDefinition>,
): Record<string, string> {
  const fallback = byId.get(fallbackThemeIdForAppearance(theme.appearance))
  return {
    ...(fallback?.tokens ?? {}),
    ...theme.tokens,
  }
}

function resolveThemeDefinition(
  theme: ThemeDefinition,
  byId: Map<string, ThemeDefinition>,
): ThemeDefinition {
  return {
    ...theme,
    tokens: resolveThemeTokens(theme, byId),
  }
}

export class ThemeRegistry {
  private snapshot: ThemeStateSnapshot | null = null

  constructor(
    private readonly store: Store<AppSettings>,
    private readonly onChanged: (snapshot: ThemeStateSnapshot) => void,
  ) {}

  private getThemesDirectoryPath(): string {
    return join(app.getPath('userData'), 'themes')
  }

  async ensureThemesDirectory(): Promise<string> {
    const dir = this.getThemesDirectoryPath()
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
    return dir
  }

  private migrateLegacySettings(): void {
    const legacyStore = this.store as unknown as Store<Record<string, unknown>>
    const legacyTheme = legacyStore.get('theme')
    if (typeof legacyTheme === 'string' && legacyTheme.trim().length > 0) {
      if (!this.store.get('activeThemeId')) this.store.set('activeThemeId', legacyTheme)
      if (legacyTheme === BUILTIN_THEME_IDS.dark && !this.store.get('defaultDarkThemeId')) {
        this.store.set('defaultDarkThemeId', legacyTheme)
      }
      if (legacyTheme === BUILTIN_THEME_IDS.light && !this.store.get('defaultLightThemeId')) {
        this.store.set('defaultLightThemeId', legacyTheme)
      }
      legacyStore.delete('theme')
    }
  }

  async reload(): Promise<ThemeStateSnapshot> {
    this.migrateLegacySettings()
    const builtins = BUILTIN_THEME_MANIFESTS.map((theme) =>
      normalizeManifest(theme, 'builtin'),
    ).filter((theme): theme is ThemeDefinition => theme !== null)
    const dir = await this.ensureThemesDirectory()
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    const userThemes: ThemeDefinition[] = []

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const filePath = join(dir, entry.name)
      try {
        const raw = JSON.parse(await readFile(filePath, 'utf-8')) as unknown
        const theme = normalizeManifest(raw, 'user', filePath)
        if (theme) userThemes.push(theme)
      } catch {
        // Ignore malformed theme files; the registry stays resilient and can be reloaded after fixes.
      }
    }

    const themes = dedupeThemes([...builtins, ...userThemes])
    const baseMap = themeMap(themes)
    const resolvedThemes = themes.map((theme) => resolveThemeDefinition(theme, baseMap))
    const resolvedMap = themeMap(resolvedThemes)

    const darkThemes = resolvedThemes.filter((theme) => theme.appearance === 'dark')
    const lightThemes = resolvedThemes.filter((theme) => theme.appearance === 'light')

    const defaultDarkThemeId = this.resolveStoredThemeId(
      this.store.get('defaultDarkThemeId'),
      darkThemes,
      BUILTIN_THEME_IDS.dark,
    )
    const defaultLightThemeId = this.resolveStoredThemeId(
      this.store.get('defaultLightThemeId'),
      lightThemes,
      BUILTIN_THEME_IDS.light,
    )

    const requestedActiveThemeId = this.store.get('activeThemeId')
    const activeThemeId =
      typeof requestedActiveThemeId === 'string' && resolvedMap.has(requestedActiveThemeId)
        ? requestedActiveThemeId
        : defaultDarkThemeId

    const snapshot: ThemeStateSnapshot = {
      themes: resolvedThemes,
      activeThemeId,
      defaultDarkThemeId,
      defaultLightThemeId,
    }

    this.store.set('activeThemeId', snapshot.activeThemeId)
    this.store.set('defaultDarkThemeId', snapshot.defaultDarkThemeId)
    this.store.set('defaultLightThemeId', snapshot.defaultLightThemeId)
    this.snapshot = snapshot
    this.onChanged(snapshot)
    return snapshot
  }

  private resolveStoredThemeId(
    requested: unknown,
    themes: ThemeDefinition[],
    fallbackId: ThemeId,
  ): ThemeId {
    if (typeof requested === 'string' && themes.some((theme) => theme.id === requested)) {
      return requested
    }
    const fallback = themes.find((theme) => theme.id === fallbackId) ?? themes[0]
    return fallback?.id ?? fallbackId
  }

  async getSnapshot(): Promise<ThemeStateSnapshot> {
    return this.snapshot ?? this.reload()
  }

  async listThemes(): Promise<ThemeDefinition[]> {
    return (await this.getSnapshot()).themes
  }

  async setActiveTheme(themeId: ThemeId): Promise<ThemeStateSnapshot> {
    const snapshot = await this.getSnapshot()
    if (!snapshot.themes.some((theme) => theme.id === themeId)) return snapshot
    if (snapshot.activeThemeId === themeId) return snapshot
    this.store.set('activeThemeId', themeId)
    this.snapshot = { ...snapshot, activeThemeId: themeId }
    this.onChanged(this.snapshot)
    return this.snapshot
  }

  async setDefaultTheme(
    appearance: ThemeAppearance,
    themeId: ThemeId,
  ): Promise<ThemeStateSnapshot> {
    const snapshot = await this.getSnapshot()
    const match = snapshot.themes.find(
      (theme) => theme.id === themeId && theme.appearance === appearance,
    )
    if (!match) return snapshot

    const key = appearance === 'dark' ? 'defaultDarkThemeId' : 'defaultLightThemeId'
    if (snapshot[key] === themeId) return snapshot

    this.store.set(key, themeId)
    this.snapshot = { ...snapshot, [key]: themeId }
    this.onChanged(this.snapshot)
    return this.snapshot
  }

  async toggleTheme(): Promise<ThemeStateSnapshot> {
    const snapshot = await this.getSnapshot()
    const current = snapshot.themes.find((theme) => theme.id === snapshot.activeThemeId)
    if (!current) return snapshot
    const nextThemeId =
      current.appearance === 'dark' ? snapshot.defaultLightThemeId : snapshot.defaultDarkThemeId
    return this.setActiveTheme(nextThemeId)
  }

  async openThemesDirectory(): Promise<void> {
    const dir = await this.ensureThemesDirectory()
    await shell.openPath(dir)
  }
}
