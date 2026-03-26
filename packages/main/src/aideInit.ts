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
 * Detect project type by scanning the workspace root for known config files.
 * More specific signals (tsconfig.json) take precedence over general ones (package.json).
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
 * Generate default editor settings based on the detected project type.
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
 * Create a new AideLocalWorkspace object with a fresh UUID.
 */
function createLocalWorkspace(): AideLocalWorkspace {
  return {
    id: randomUUID(),
    ribbonPosition: 0,
    lastOpenedAt: Date.now(),
  }
}

/**
 * Idempotent .aide folder initialization.
 *
 * Creates only the pieces that are missing:
 * - .aide/ directory
 * - .aide/.gitignore
 * - .aide/local/ directory
 * - .aide/local/workspace.json (with new UUID)
 * - .aide/settings.json (with detected defaults — only if no settings.json exists)
 *
 * Safe to call on every workspace open. Handles:
 * - Fresh project (no .aide/ at all)
 * - Collaborator first-open (.aide/ exists from git, but no local/)
 * - Existing workspace (everything exists — no-op)
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
 * Read the local workspace metadata from .aide/local/workspace.json.
 * Returns null if the file doesn't exist or is corrupted.
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
 * Write (merge) updates into .aide/local/workspace.json.
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
