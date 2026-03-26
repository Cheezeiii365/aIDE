/**
 * .aide project folder initialization and project type detection.
 *
 * Handles creating the .aide/ directory structure, detecting project types,
 * and generating default settings.json files for new workspaces.
 */

import { existsSync } from 'fs'
import { mkdir, writeFile, readFile } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { AideProjectSettings, AideLocalWorkspace, ProjectType, AideInitResult } from '@aide/shared'

const AIDE_DIR = '.aide'
const LOCAL_DIR = 'local'
const GITIGNORE_CONTENT = `# Machine-local state — not shared
local/
`

/**
 * Detects the project's language or framework by checking for well-known configuration files in the workspace root.
 *
 * @returns The detected project type: `'typescript'`, `'rust'`, `'go'`, `'python'`, `'ruby'`, `'node'`, or `'unknown'`.
 */
export async function detectProjectType(rootPath: string): Promise<ProjectType> {
  const exists = (name: string) => existsSync(join(rootPath, name))

  // Most specific first
  if (exists('tsconfig.json')) return 'typescript'
  if (exists('Cargo.toml')) return 'rust'
  if (exists('go.mod')) return 'go'
  if (exists('pyproject.toml') || exists('requirements.txt') || exists('setup.py')) return 'python'
  if (exists('Gemfile')) return 'ruby'
  if (exists('package.json')) return 'node'

  return 'unknown'
}

/**
 * Create editor settings tailored to the detected project type.
 *
 * @param projectType - The detected project type used to select indentation and file-exclude defaults
 * @returns An AideProjectSettings object containing base settings plus project-type-specific tab size, space/indent settings, and file exclusion entries
 */
export function generateDefaultSettings(projectType: ProjectType): AideProjectSettings {
  const base: AideProjectSettings = {
    formatOnSave: false,
    filesExclude: {
      'node_modules': true,
      '.git': true,
      '.DS_Store': true,
    },
  }

  switch (projectType) {
    case 'typescript':
    case 'node':
      return {
        ...base,
        tabSize: 2,
        insertSpaces: true,
        filesExclude: { ...base.filesExclude, dist: true, build: true },
      }
    case 'python':
      return {
        ...base,
        tabSize: 4,
        insertSpaces: true,
        filesExclude: { ...base.filesExclude, __pycache__: true, '.pytest_cache': true, '*.pyc': true },
      }
    case 'rust':
      return {
        ...base,
        tabSize: 4,
        insertSpaces: true,
        filesExclude: { ...base.filesExclude, target: true },
      }
    case 'go':
      return {
        ...base,
        tabSize: 4,
        insertSpaces: false,
      }
    case 'ruby':
      return {
        ...base,
        tabSize: 2,
        insertSpaces: true,
      }
    default:
      return {
        ...base,
        tabSize: 2,
        insertSpaces: true,
      }
  }
}

/**
 * Create a new local workspace metadata object.
 *
 * @returns A new AideLocalWorkspace with a unique `id`, `ribbonPosition` set to `0`, and `lastOpenedAt` set to the current timestamp.
 */
function createLocalWorkspace(): AideLocalWorkspace {
  return {
    id: randomUUID(),
    ribbonPosition: 0,
    lastOpenedAt: Date.now(),
  }
}

/**
 * Initialize and maintain a project's `.aide` workspace folder.
 *
 * Creates missing pieces (directory structure, `.gitignore`, `.aide/local/workspace.json`,
 * and `.aide/settings.json` defaults) and updates local workspace metadata when present.
 *
 * @param rootPath - Path to the project root where the `.aide` folder should be ensured
 * @returns An object containing `projectType` (detected project type), `created` (`true` if `.aide/` was created by this call, `false` if it already existed), and `rootPath` (the provided project root)
 */
export async function ensureAideFolder(rootPath: string): Promise<AideInitResult> {
  const aideDir = join(rootPath, AIDE_DIR)
  const localDir = join(aideDir, LOCAL_DIR)
  const gitignorePath = join(aideDir, '.gitignore')
  const settingsPath = join(aideDir, 'settings.json')
  const workspacePath = join(localDir, 'workspace.json')

  const isNewInit = !existsSync(aideDir)

  // Create directories
  if (!existsSync(aideDir)) {
    await mkdir(aideDir, { recursive: true })
  }
  if (!existsSync(localDir)) {
    await mkdir(localDir, { recursive: true })
  }

  // Create .gitignore
  if (!existsSync(gitignorePath)) {
    await writeFile(gitignorePath, GITIGNORE_CONTENT, 'utf-8')
  }

  // Create local workspace metadata
  if (!existsSync(workspacePath)) {
    const localWorkspace = createLocalWorkspace()
    await writeFile(workspacePath, JSON.stringify(localWorkspace, null, 2), 'utf-8')
  } else {
    // Update lastOpenedAt on existing workspace
    try {
      const existing = JSON.parse(await readFile(workspacePath, 'utf-8')) as AideLocalWorkspace
      existing.lastOpenedAt = Date.now()
      await writeFile(workspacePath, JSON.stringify(existing, null, 2), 'utf-8')
    } catch {
      // Corrupted file — recreate
      const localWorkspace = createLocalWorkspace()
      await writeFile(workspacePath, JSON.stringify(localWorkspace, null, 2), 'utf-8')
    }
  }

  // Detect project type
  const projectType = await detectProjectType(rootPath)

  // Create default settings.json only if it doesn't exist
  if (!existsSync(settingsPath)) {
    const defaults = generateDefaultSettings(projectType)
    await writeFile(settingsPath, JSON.stringify(defaults, null, 2), 'utf-8')
  }

  return {
    projectType,
    created: isNewInit,
    rootPath,
  }
}

/**
 * Reads the local workspace metadata from the project's .aide/local/workspace.json.
 *
 * @param rootPath - The project root directory containing the `.aide` folder
 * @returns The parsed `AideLocalWorkspace`, or `null` if the file is missing or contains invalid JSON
 */
export async function readLocalWorkspace(rootPath: string): Promise<AideLocalWorkspace | null> {
  const workspacePath = join(rootPath, AIDE_DIR, LOCAL_DIR, 'workspace.json')
  if (!existsSync(workspacePath)) return null

  try {
    return JSON.parse(await readFile(workspacePath, 'utf-8')) as AideLocalWorkspace
  } catch {
    return null
  }
}

/**
 * Merge partial workspace updates into the project's `.aide/local/workspace.json`.
 *
 * If the file is missing or contains invalid JSON, a new workspace object with a fresh `id` is created before applying the updates. The merge is shallow: top-level fields in `updates` overwrite existing top-level fields.
 *
 * @param rootPath - Project root directory containing the `.aide` folder
 * @param updates - Partial workspace fields to merge into the existing workspace metadata
 */
export async function updateLocalWorkspace(
  rootPath: string,
  updates: Partial<AideLocalWorkspace>,
): Promise<void> {
  const workspacePath = join(rootPath, AIDE_DIR, LOCAL_DIR, 'workspace.json')
  let existing: AideLocalWorkspace

  try {
    existing = JSON.parse(await readFile(workspacePath, 'utf-8')) as AideLocalWorkspace
  } catch {
    existing = createLocalWorkspace()
  }

  const merged = { ...existing, ...updates }
  await writeFile(workspacePath, JSON.stringify(merged, null, 2), 'utf-8')
}
