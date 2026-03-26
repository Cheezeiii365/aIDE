/**
 * Task variable resolver.
 *
 * Resolves ${variable} placeholders in task commands, args, cwd, and env values.
 * Supports workspace, file, git, environment, and user input variables.
 */

import { execFileSync } from 'child_process'

export interface TaskVariableContext {
  workspaceRoot: string
  workspaceName: string
  activeFile?: string
  selectedText?: string
  lineNumber?: number
  resolvedInputs?: Record<string, string>
}

const VARIABLE_RE = /\$\{([^}]+)\}/g

/**
 * Get the current git branch name using execFileSync (no shell injection risk).
 * Returns empty string if not in a git repo.
 */
function getGitBranch(cwd: string): string {
  try {
    return execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf-8' }).trim()
  } catch {
    return ''
  }
}

/**
 * Resolve a single variable reference.
 * Returns the resolved value or the original placeholder if unknown.
 */
function resolveVariable(name: string, ctx: TaskVariableContext): string {
  switch (name) {
    case 'workspaceRoot':
      return ctx.workspaceRoot
    case 'workspaceName':
      return ctx.workspaceName
    case 'file':
      return ctx.activeFile ?? ''
    case 'fileRelative': {
      if (!ctx.activeFile) return ''
      const rel = ctx.activeFile.startsWith(ctx.workspaceRoot)
        ? ctx.activeFile.slice(ctx.workspaceRoot.length + 1)
        : ctx.activeFile
      return rel
    }
    case 'fileBasename':
      return ctx.activeFile?.split('/').pop() ?? ''
    case 'fileExtname': {
      const base = ctx.activeFile?.split('/').pop() ?? ''
      const dotIdx = base.lastIndexOf('.')
      return dotIdx >= 0 ? base.slice(dotIdx) : ''
    }
    case 'fileDirname': {
      if (!ctx.activeFile) return ''
      const parts = ctx.activeFile.split('/')
      parts.pop()
      return parts.join('/')
    }
    case 'selectedText':
      return ctx.selectedText ?? ''
    case 'lineNumber':
      return ctx.lineNumber?.toString() ?? ''
    case 'branch':
      return getGitBranch(ctx.workspaceRoot)
    case 'datetime':
      return new Date().toISOString()
    default:
      // ${env:NAME} — system environment variable
      if (name.startsWith('env:')) {
        const envName = name.slice(4)
        return process.env[envName] ?? ''
      }
      // ${input:id} — user input (must be pre-resolved)
      if (name.startsWith('input:')) {
        const inputId = name.slice(6)
        return ctx.resolvedInputs?.[inputId] ?? ''
      }
      return `\${${name}}`
  }
}

/**
 * Resolve all ${variable} placeholders in a string.
 */
export function resolveVariables(template: string, ctx: TaskVariableContext): string {
  return template.replace(VARIABLE_RE, (_match, name: string) => resolveVariable(name, ctx))
}

/**
 * Find all ${input:id} references in a task's command, args, cwd, promptBefore, and env.
 */
export function findInputReferences(task: {
  command: string
  args?: string[]
  cwd?: string
  promptBefore?: string
  env?: Record<string, string>
}): string[] {
  const inputIds = new Set<string>()
  const scan = (str: string) => {
    let match: RegExpExecArray | null
    const re = /\$\{input:([^}]+)\}/g
    while ((match = re.exec(str)) !== null) {
      inputIds.add(match[1])
    }
  }

  scan(task.command)
  task.args?.forEach(scan)
  if (task.cwd) scan(task.cwd)
  if (task.promptBefore) scan(task.promptBefore)
  if (task.env) Object.values(task.env).forEach(scan)

  return Array.from(inputIds)
}
