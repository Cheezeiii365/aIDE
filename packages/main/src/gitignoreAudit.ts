/**
 * Gitignore security audit.
 *
 * Parses the project's .gitignore and checks for common security patterns
 * that should be present to prevent accidental credential/secret commits.
 * Provides utilities to append missing patterns with user confirmation.
 */

import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { readLocalWorkspace, updateLocalWorkspace } from './aideInit'

/**
 * Security-critical patterns that every project's .gitignore should include.
 * Grouped by category for display in the review modal.
 */
export const SECURITY_PATTERNS: { pattern: string; category: string }[] = [
  // Environment & secrets
  { pattern: '.env', category: 'Environment & secrets' },
  { pattern: '.env.*', category: 'Environment & secrets' },
  { pattern: '.env.local', category: 'Environment & secrets' },
  { pattern: '.env.*.local', category: 'Environment & secrets' },

  // Private keys & certificates
  { pattern: '*.pem', category: 'Private keys & certificates' },
  { pattern: '*.key', category: 'Private keys & certificates' },
  { pattern: '*.p12', category: 'Private keys & certificates' },
  { pattern: '*.keystore', category: 'Private keys & certificates' },
  { pattern: '*.pfx', category: 'Private keys & certificates' },

  // Credentials files
  { pattern: 'credentials.json', category: 'Credentials files' },
  { pattern: 'secrets.json', category: 'Credentials files' },
  { pattern: 'serviceAccountKey.json', category: 'Credentials files' },
  { pattern: '**/service-account*.json', category: 'Credentials files' },

  // Cloud provider
  { pattern: '.aws/', category: 'Cloud provider' },
  { pattern: '.gcp/', category: 'Cloud provider' },
  { pattern: 'terraform.tfstate', category: 'Cloud provider' },
  { pattern: 'terraform.tfstate.backup', category: 'Cloud provider' },
  { pattern: '*.tfvars', category: 'Cloud provider' },

  // IDE local state
  { pattern: '.aide/local/', category: 'IDE local state' },

  // OS artifacts
  { pattern: '.DS_Store', category: 'OS artifacts' },
  { pattern: 'Thumbs.db', category: 'OS artifacts' },
]

/**
 * Parse `.gitignore` file contents into a set of normalized pattern strings.
 *
 * @param content - The raw contents of a `.gitignore` file
 * @returns A `Set` containing each non-empty, non-comment line trimmed of leading and trailing whitespace
 */
function parseGitignore(content: string): Set<string> {
  const patterns = new Set<string>()
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    // Skip empty lines and comments
    if (!line || line.startsWith('#')) continue
    patterns.add(line)
  }
  return patterns
}

/**
 * Determine whether a security pattern is present in the set of existing .gitignore entries.
 *
 * Checks for literal presence and common leading-slash variants; does not perform glob or pattern matching.
 *
 * @param pattern - The security pattern to check (literal `.gitignore` line)
 * @param existingPatterns - A set of normalized `.gitignore` lines previously parsed
 * @returns `true` if `pattern` or its leading-slash/without-leading-slash variant exists in `existingPatterns`, `false` otherwise
 */
function isPatternCovered(pattern: string, existingPatterns: Set<string>): boolean {
  // Direct match
  if (existingPatterns.has(pattern)) return true
  // Some projects use leading slash — check with and without
  if (existingPatterns.has('/' + pattern)) return true
  if (pattern.startsWith('/') && existingPatterns.has(pattern.slice(1))) return true
  return false
}

export interface AuditResult {
  missing: { pattern: string; category: string }[]
  total: number
}

/**
 * Identify security-related .gitignore patterns that are missing from a project's .gitignore.
 *
 * @param rootPath - Filesystem path to the project root containing the `.gitignore` file
 * @returns An AuditResult containing `missing` (array of `{ pattern, category }` entries not found) and `total` number of audited security patterns
 */
export async function auditGitignore(rootPath: string): Promise<AuditResult> {
  const gitignorePath = join(rootPath, '.gitignore')

  let existingPatterns = new Set<string>()
  if (existsSync(gitignorePath)) {
    const content = await readFile(gitignorePath, 'utf-8')
    existingPatterns = parseGitignore(content)
  }

  const missing = SECURITY_PATTERNS.filter(
    (sp) => !isPatternCovered(sp.pattern, existingPatterns),
  )

  return {
    missing,
    total: SECURITY_PATTERNS.length,
  }
}

/**
 * Append specified security patterns to the repository's .gitignore under a header comment.
 *
 * Creates the file if it does not exist and preserves existing trailing newlines so the added block is separated.
 *
 * @param rootPath - Filesystem path to the repository root containing the `.gitignore`
 * @param patterns - Lines to append to `.gitignore`; each entry is written verbatim as its own line
 */
export async function appendToGitignore(
  rootPath: string,
  patterns: string[],
): Promise<void> {
  const gitignorePath = join(rootPath, '.gitignore')

  let existing = ''
  if (existsSync(gitignorePath)) {
    existing = await readFile(gitignorePath, 'utf-8')
  }

  // Ensure trailing newline before appending
  const separator = existing && !existing.endsWith('\n') ? '\n\n' : existing ? '\n' : ''

  const block = [
    '# Security patterns added by aIDE',
    ...patterns,
    '',
  ].join('\n')

  await writeFile(gitignorePath, existing + separator + block, 'utf-8')
}

/**
 * Determine whether the gitignore audit has been dismissed for the workspace at the given root path.
 *
 * @returns `true` if the workspace metadata's `gitignoreAuditDismissed` flag is set to `true`, `false` otherwise.
 */
export async function isAuditDismissed(rootPath: string): Promise<boolean> {
  const workspace = await readLocalWorkspace(rootPath)
  return workspace?.gitignoreAuditDismissed === true
}

/**
 * Persist that the gitignore security audit has been dismissed for the workspace.
 *
 * @param rootPath - Filesystem path of the project workspace where the dismissal flag will be set
 */
export async function dismissAudit(rootPath: string): Promise<void> {
  await updateLocalWorkspace(rootPath, { gitignoreAuditDismissed: true })
}
