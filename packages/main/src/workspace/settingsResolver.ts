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
import type {
  AppSettings,
  AideProjectSettings,
  ResolvedSettings,
  PermissionTier,
  ToolPermissionConfig,
  AgentBackend,
} from '@aide/shared'

export const BUILT_IN_DEFAULTS: ResolvedSettings = {
  tabSize: 2,
  insertSpaces: true,
  wordWrap: 'off',
  rulers: [],
  fontSize: 13,
  fontFamily: "'SF Mono', Menlo, Monaco, 'Courier New', monospace",
  formatOnSave: false,
  filesExclude: {},
  searchExclude: {},

  // Agent / LLM defaults
  'agent.provider': 'anthropic',
  'agent.model': 'claude-sonnet-4-20250514',
  'agent.apiKey': '',
  'agent.baseUrl': '',
  'agent.maxTurns': 25,
  'agent.maxTokens': 8192,

  // Agent / Permission defaults
  'agent.permissionTier': 'confirm' as PermissionTier,
  'agent.autoApprove': {} as Record<string, boolean | ToolPermissionConfig>,

  // Agent / Backend defaults
  'agent.backend': 'built-in' as AgentBackend,
  'agent.claudeCodePath': '',
  'agent.opencodePath': '',
  'agent.codexPath': '',
}

/**
 * Compute editor default settings by applying persisted user editor defaults on top of built-in fallbacks.
 *
 * @param store - Electron store used to read the saved `editorDefaults` entry
 * @returns A ResolvedSettings object where each scalar setting is the user value if present, otherwise the built-in default; `filesExclude` and `searchExclude` are shallow-merged so user entries override built-in entries
 */
export function resolveAppDefaults(store: Store<AppSettings>): ResolvedSettings {
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

    // Agent / LLM
    'agent.provider': userDefaults['agent.provider'] ?? BUILT_IN_DEFAULTS['agent.provider'],
    'agent.model': userDefaults['agent.model'] ?? BUILT_IN_DEFAULTS['agent.model'],
    'agent.apiKey': userDefaults['agent.apiKey'] ?? BUILT_IN_DEFAULTS['agent.apiKey'],
    'agent.baseUrl': userDefaults['agent.baseUrl'] ?? BUILT_IN_DEFAULTS['agent.baseUrl'],
    'agent.maxTurns': userDefaults['agent.maxTurns'] ?? BUILT_IN_DEFAULTS['agent.maxTurns'],
    'agent.maxTokens': userDefaults['agent.maxTokens'] ?? BUILT_IN_DEFAULTS['agent.maxTokens'],

    // Agent / Permissions
    'agent.permissionTier':
      userDefaults['agent.permissionTier'] ?? BUILT_IN_DEFAULTS['agent.permissionTier'],
    'agent.autoApprove': {
      ...BUILT_IN_DEFAULTS['agent.autoApprove'],
      ...(userDefaults['agent.autoApprove'] ?? {}),
    },

    // Agent / Backend
    'agent.backend': userDefaults['agent.backend'] ?? BUILT_IN_DEFAULTS['agent.backend'],
    'agent.claudeCodePath':
      userDefaults['agent.claudeCodePath'] ?? BUILT_IN_DEFAULTS['agent.claudeCodePath'],
    'agent.opencodePath':
      userDefaults['agent.opencodePath'] ?? BUILT_IN_DEFAULTS['agent.opencodePath'],
    'agent.codexPath': userDefaults['agent.codexPath'] ?? BUILT_IN_DEFAULTS['agent.codexPath'],
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

  // Merge: project > user > built-in (appDefaults already incorporates user defaults)
  return {
    tabSize: projectSettings.tabSize ?? appDefaults.tabSize,
    insertSpaces: projectSettings.insertSpaces ?? appDefaults.insertSpaces,
    wordWrap: projectSettings.wordWrap ?? appDefaults.wordWrap,
    rulers: projectSettings.rulers ?? appDefaults.rulers,
    fontSize: projectSettings.fontSize ?? appDefaults.fontSize,
    fontFamily: projectSettings.fontFamily ?? appDefaults.fontFamily,
    formatOnSave: projectSettings.formatOnSave ?? appDefaults.formatOnSave,
    filesExclude: {
      ...appDefaults.filesExclude,
      ...projectSettings.filesExclude,
    },
    searchExclude: {
      ...appDefaults.searchExclude,
      ...projectSettings.searchExclude,
    },

    // Agent / LLM (provider & model may be project-scoped; credentials are user-only)
    'agent.provider': projectSettings['agent.provider'] ?? appDefaults['agent.provider'],
    'agent.model': projectSettings['agent.model'] ?? appDefaults['agent.model'],
    'agent.apiKey': appDefaults['agent.apiKey'],
    'agent.baseUrl': appDefaults['agent.baseUrl'],
    'agent.maxTurns': projectSettings['agent.maxTurns'] ?? appDefaults['agent.maxTurns'],
    'agent.maxTokens': projectSettings['agent.maxTokens'] ?? appDefaults['agent.maxTokens'],

    // Agent / Permissions (user-only — project settings must not weaken the trust boundary)
    'agent.permissionTier': appDefaults['agent.permissionTier'],
    'agent.autoApprove': appDefaults['agent.autoApprove'],

    // Agent / Backend (user-only — executable paths must not come from untrusted repos)
    'agent.backend': appDefaults['agent.backend'],
    'agent.claudeCodePath': appDefaults['agent.claudeCodePath'],
    'agent.opencodePath': appDefaults['agent.opencodePath'],
    'agent.codexPath': appDefaults['agent.codexPath'],
  }
}
