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
 * Compute editor default settings by applying persisted user editor defaults on top of built-in fallbacks.
 *
 * @param store - Electron store used to read the saved `editorDefaults` entry
 * @returns A ResolvedSettings object where each scalar setting is the user value if present, otherwise the built-in default; `filesExclude` and `searchExclude` are shallow-merged so user entries override built-in entries
 */
export function resolveAppDefaults(
  store: Store<AppSettings>,
): ResolvedSettings {
  const userDefaults = (store.get('editorDefaults') ?? {}) as Partial<AideProjectSettings>

  return {
    tabSize: userDefaults.tabSize ?? BUILT_IN_DEFAULTS.tabSize,
    insertSpaces: userDefaults.insertSpaces ?? BUILT_IN_DEFAULTS.insertSpaces,
    wordWrap: userDefaults.wordWrap ?? BUILT_IN_DEFAULTS.wordWrap,
    rulers: userDefaults.rulers ?? BUILT_IN_DEFAULTS.rulers,
    fontSize: userDefaults.fontSize ?? BUILT_IN_DEFAULTS.fontSize,
    fontFamily: userDefaults.fontFamily ?? BUILT_IN_DEFAULTS.fontFamily,
    formatOnSave: userDefaults.formatOnSave ?? BUILT_IN_DEFAULTS.formatOnSave,
    filesExclude: {
      ...BUILT_IN_DEFAULTS.filesExclude,
      ...userDefaults.filesExclude,
    },
    searchExclude: {
      ...BUILT_IN_DEFAULTS.searchExclude,
      ...userDefaults.searchExclude,
    },
  }
}

/**
 * Loads project-level settings from the .aide/settings.json file in the given project root.
 *
 * @param rootPath - Path to the project root directory
 * @returns The parsed `AideProjectSettings` from the file, or an empty object if the file is absent or cannot be parsed
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
 * Compute editor settings for a workspace by merging project, user, and built-in defaults.
 *
 * Files- and search-exclusion maps are shallow-merged so project entries override earlier layers.
 *
 * @param rootPath - Absolute path to the workspace/project root where `.aide/settings.json` may reside
 * @returns A `ResolvedSettings` object where each scalar field is taken from project settings if present, otherwise user defaults, otherwise built-in defaults; `filesExclude` and `searchExclude` are shallow-merged with project entries taking precedence.
 */
export async function resolveSettings(
  rootPath: string,
  store: Store<AppSettings>,
): Promise<ResolvedSettings> {
  const projectSettings = await readProjectSettings(rootPath)
  const appDefaults = resolveAppDefaults(store)
  const userDefaults = (store.get('editorDefaults') ?? {}) as Partial<AideProjectSettings>

  // Merge: project > user > built-in
  return {
    tabSize: projectSettings.tabSize ?? userDefaults.tabSize ?? appDefaults.tabSize,
    insertSpaces:
      projectSettings.insertSpaces ?? userDefaults.insertSpaces ?? appDefaults.insertSpaces,
    wordWrap: projectSettings.wordWrap ?? userDefaults.wordWrap ?? appDefaults.wordWrap,
    rulers: projectSettings.rulers ?? userDefaults.rulers ?? appDefaults.rulers,
    fontSize: projectSettings.fontSize ?? userDefaults.fontSize ?? appDefaults.fontSize,
    fontFamily:
      projectSettings.fontFamily ?? userDefaults.fontFamily ?? appDefaults.fontFamily,
    formatOnSave:
      projectSettings.formatOnSave ?? userDefaults.formatOnSave ?? appDefaults.formatOnSave,
    filesExclude: {
      ...appDefaults.filesExclude,
      ...projectSettings.filesExclude,
    },
    searchExclude: {
      ...appDefaults.searchExclude,
      ...projectSettings.searchExclude,
    },
  }
}
