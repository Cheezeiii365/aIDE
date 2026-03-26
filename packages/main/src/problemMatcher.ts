/**
 * Problem matcher engine.
 *
 * Parses task output lines against regex patterns to extract file, line, column,
 * severity, and message — surfacing them as editor diagnostics without LSP.
 * Includes built-in matchers for common tools.
 *
 * Note: This module only performs regex matching on task output strings.
 * No shell commands are invoked.
 */

import type { TaskDiagnostic } from '@aide/shared'

export type BuiltinMatcherName = 'tsc' | 'eslint-compact' | 'python' | 'gcc' | 'go' | 'pytest' | 'generic'

interface MatcherDef {
  pattern: RegExp
  file: number
  line?: number
  column?: number
  severity?: number
  message: number
  defaultSeverity: 'error' | 'warning' | 'info'
}

type MatcherFn = (line: string, source: string) => TaskDiagnostic | null

const BUILTIN_MATCHERS: Record<BuiltinMatcherName, MatcherDef> = {
  // TypeScript: src/foo.ts(10,5): error TS2322: Type 'string' is not assignable...
  tsc: {
    pattern: /^(.+)\((\d+),(\d+)\):\s+(error|warning)\s+TS\d+:\s+(.+)$/,
    file: 1,
    line: 2,
    column: 3,
    severity: 4,
    message: 5,
    defaultSeverity: 'error',
  },

  // ESLint compact: /path/file.ts: line 10, col 5, Error - message (rule)
  'eslint-compact': {
    pattern: /^(.+):\s+line\s+(\d+),\s+col\s+(\d+),\s+(Error|Warning)\s+-\s+(.+)$/,
    file: 1,
    line: 2,
    column: 3,
    severity: 4,
    message: 5,
    defaultSeverity: 'error',
  },

  // Python traceback: File "path", line N
  python: {
    pattern: /^\s*File\s+"(.+)",\s+line\s+(\d+)/,
    file: 1,
    line: 2,
    message: 0, // Use full line as message for Python tracebacks
    defaultSeverity: 'error',
  },

  // GCC/Clang: file:line:col: error: message
  gcc: {
    pattern: /^(.+):(\d+):(\d+):\s+(error|warning|note):\s+(.+)$/,
    file: 1,
    line: 2,
    column: 3,
    severity: 4,
    message: 5,
    defaultSeverity: 'error',
  },

  // Go: same as gcc format
  go: {
    pattern: /^(.+):(\d+):(\d+):\s+(.+)$/,
    file: 1,
    line: 2,
    column: 3,
    message: 4,
    defaultSeverity: 'error',
  },

  // Pytest: FAILED path/test.py::test_name - AssertionError
  pytest: {
    pattern: /^FAILED\s+(.+?)::(.+?)\s+-\s+(.+)$/,
    file: 1,
    message: 3,
    defaultSeverity: 'error',
  },

  // Generic: file:line:col: message
  generic: {
    pattern: /^(.+):(\d+):(\d+):\s+(.+)$/,
    file: 1,
    line: 2,
    column: 3,
    message: 4,
    defaultSeverity: 'error',
  },
}

/**
 * Normalize a raw severity token into one of the canonical levels: `error`, `warning`, or `info`.
 *
 * @param raw - The raw severity string extracted from output (may be `undefined`)
 * @returns `'error'` if `raw` is missing or does not match known tokens; `'warning'` for `warning` or `warn`; `'info'` for `info` or `note`
 */
function normalizeSeverity(raw: string | undefined): 'error' | 'warning' | 'info' {
  if (!raw) return 'error'
  const lower = raw.toLowerCase()
  if (lower === 'warning' || lower === 'warn') return 'warning'
  if (lower === 'info' || lower === 'note') return 'info'
  return 'error'
}

/**
 * Create a matcher function that parses a single output line using the provided matcher definition.
 *
 * @param def - Matcher definition mapping regex capture groups to diagnostic fields and providing a default severity
 * @returns A function that returns a `TaskDiagnostic` when the pattern matches and a non-empty file is extracted, or `null` otherwise. The returned diagnostic includes `file`, optional `line`, optional `column`, `severity` (normalized or the definition's default), `message`, and the original `source`.
 */
function createMatcherFromDef(def: MatcherDef): MatcherFn {
  return (line: string, source: string): TaskDiagnostic | null => {
    const match = def.pattern.exec(line)
    if (!match) return null

    const file = def.file > 0 ? match[def.file] : ''
    const lineNum = def.line && def.line > 0 ? parseInt(match[def.line], 10) : undefined
    const column = def.column && def.column > 0 ? parseInt(match[def.column], 10) : undefined
    const severity = def.severity && def.severity > 0
      ? normalizeSeverity(match[def.severity])
      : def.defaultSeverity
    const message = def.message > 0 ? match[def.message] : line.trim()

    if (!file) return null

    return { file, line: lineNum, column, severity, message, source }
  }
}

/**
 * Produce a matcher function for the given built-in matcher name.
 *
 * @returns A matcher function that parses lines into `TaskDiagnostic` objects for the specified built-in matcher, or `null` if the name is not recognized.
 */
export function createMatcher(name: BuiltinMatcherName): MatcherFn | null {
  const def = BUILTIN_MATCHERS[name]
  if (!def) return null
  return createMatcherFromDef(def)
}

/**
 * List all available built-in matcher names.
 *
 * @returns An array containing every registered built-in matcher identifier.
 */
export function getBuiltinMatcherNames(): BuiltinMatcherName[] {
  return Object.keys(BUILTIN_MATCHERS) as BuiltinMatcherName[]
}
