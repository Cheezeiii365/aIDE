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
 * Parse a .gitignore file into a set of normalized pattern strings.
 * Strips comments, empty lines, and leading/trailing whitespace.
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
 * Check if a security pattern is covered by the existing .gitignore patterns.
 *
 * A pattern is "covered" if it appears literally in the gitignore.
 * We don't try to do full glob matching — literal presence is sufficient
 * for this security heuristic.
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
 * Audit a project's .gitignore for missing security patterns.
 * Returns the list of missing patterns grouped by category.
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
 * Append security patterns to .gitignore, grouped under a header comment.
 * Creates the file if it doesn't exist.
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
 * Check if the gitignore audit has been dismissed for this project.
 */
export async function isAuditDismissed(rootPath: string): Promise<boolean> {
  const workspace = await readLocalWorkspace(rootPath)
  return workspace?.gitignoreAuditDismissed === true
}

/**
 * Mark the gitignore audit as dismissed for this project.
 */
export async function dismissAudit(rootPath: string): Promise<void> {
  await updateLocalWorkspace(rootPath, { gitignoreAuditDismissed: true })
}
