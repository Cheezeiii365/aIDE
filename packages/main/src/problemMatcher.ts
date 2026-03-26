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
  line: number
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
    line: 0, // Pytest doesn't provide line numbers in this format
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

function normalizeSeverity(raw: string | undefined): 'error' | 'warning' | 'info' {
  if (!raw) return 'error'
  const lower = raw.toLowerCase()
  if (lower === 'warning' || lower === 'warn') return 'warning'
  if (lower === 'info' || lower === 'note') return 'info'
  return 'error'
}

function createMatcherFromDef(def: MatcherDef): MatcherFn {
  return (line: string, source: string): TaskDiagnostic | null => {
    const match = def.pattern.exec(line)
    if (!match) return null

    const file = def.file > 0 ? match[def.file] : ''
    const lineNum = def.line > 0 ? parseInt(match[def.line], 10) : 0
    const column = def.column && def.column > 0 ? parseInt(match[def.column], 10) : undefined
    const severity = def.severity && def.severity > 0
      ? normalizeSeverity(match[def.severity])
      : def.defaultSeverity
    const message = def.message > 0 ? match[def.message] : line.trim()

    if (!file || lineNum === 0) return null

    return { file, line: lineNum, column, severity, message, source }
  }
}

/**
 * Create a matcher function from a built-in matcher name.
 * Returns null if the name is not recognized.
 */
export function createMatcher(name: BuiltinMatcherName): MatcherFn | null {
  const def = BUILTIN_MATCHERS[name]
  if (!def) return null
  return createMatcherFromDef(def)
}

/**
 * Get all available built-in matcher names.
 */
export function getBuiltinMatcherNames(): BuiltinMatcherName[] {
  return Object.keys(BUILTIN_MATCHERS) as BuiltinMatcherName[]
}
