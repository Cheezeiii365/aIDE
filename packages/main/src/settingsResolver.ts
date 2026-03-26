/**
 * Settings cascade resolver.
 *
 * Resolves editor settings with three-layer priority (highest wins):
 * 1. .aide/settings.json  (project-level, committed)
 * 2. App-level electron-store editorDefaults  (user global preferences)
 * 3. Built-in defaults
 */

import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import type Store from 'electron-store'
import type { AppSettings, AideProjectSettings, ResolvedSettings } from '@aide/shared'

const BUILT_IN_DEFAULTS: ResolvedSettings = {
  tabSize: 2,
  insertSpaces: true,
  wordWrap: 'off',
  rulers: [],
  fontSize: 13,
  fontFamily: "'SF Mono', Menlo, Monaco, 'Courier New', monospace",
  formatOnSave: false,
  filesExclude: {},
  searchExclude: {},
}

/**
 * Read .aide/settings.json from a project root.
 * Returns an empty object if the file doesn't exist or is invalid.
 */
async function readProjectSettings(rootPath: string): Promise<AideProjectSettings> {
  const settingsPath = join(rootPath, '.aide', 'settings.json')
  if (!existsSync(settingsPath)) return {}

  try {
    const raw = await readFile(settingsPath, 'utf-8')
    return JSON.parse(raw) as AideProjectSettings
  } catch {
    return {}
  }
}

/**
 * Resolve settings for a workspace by merging three layers.
 *
 * Priority: project settings > user defaults > built-in defaults.
 * Language-specific overrides from .aide/settings.json are NOT applied here —
 * they require knowing the active file's language, which is a renderer concern.
 */
export async function resolveSettings(
  rootPath: string,
  store: Store<AppSettings>,
): Promise<ResolvedSettings> {
  const projectSettings = await readProjectSettings(rootPath)

  // User-global editor defaults from electron-store (if any)
  const userDefaults = (store.get('editorDefaults') ?? {}) as Partial<AideProjectSettings>

  // Merge: project > user > built-in
  return {
    tabSize: projectSettings.tabSize ?? userDefaults.tabSize ?? BUILT_IN_DEFAULTS.tabSize,
    insertSpaces:
      projectSettings.insertSpaces ?? userDefaults.insertSpaces ?? BUILT_IN_DEFAULTS.insertSpaces,
    wordWrap: projectSettings.wordWrap ?? userDefaults.wordWrap ?? BUILT_IN_DEFAULTS.wordWrap,
    rulers: projectSettings.rulers ?? userDefaults.rulers ?? BUILT_IN_DEFAULTS.rulers,
    fontSize: projectSettings.fontSize ?? userDefaults.fontSize ?? BUILT_IN_DEFAULTS.fontSize,
    fontFamily:
      projectSettings.fontFamily ?? userDefaults.fontFamily ?? BUILT_IN_DEFAULTS.fontFamily,
    formatOnSave:
      projectSettings.formatOnSave ?? userDefaults.formatOnSave ?? BUILT_IN_DEFAULTS.formatOnSave,
    filesExclude: {
      ...BUILT_IN_DEFAULTS.filesExclude,
      ...userDefaults.filesExclude,
      ...projectSettings.filesExclude,
    },
    searchExclude: {
      ...BUILT_IN_DEFAULTS.searchExclude,
      ...userDefaults.searchExclude,
      ...projectSettings.searchExclude,
    },
  }
}
