/**
 * Task variable resolver.
 *
 * Resolves ${variable} placeholders in task commands, args, cwd, and env values.
 * Supports workspace, file, git, environment, and user input variables.
 */

import { execFileSync } from 'child_process'

export interface TaskVariableContext {
  /** Default task cwd and ${workspaceRoot}: active git worktree when set, else repo root. */
  workspaceRoot: string
  workspaceName: string
  activeFile?: string
  selectedText?: string
  lineNumber?: number
  resolvedInputs?: Record<string, string>
}

const VARIABLE_RE = /\$\{([^}]+)\}/g

/**
 * Retrieve the current Git branch name for the repository at the specified working directory.
 *
 * @param cwd - The working directory in which to run Git
 * @returns The current branch name, or an empty string if the branch cannot be determined
 */
function getGitBranch(cwd: string): string {
  try {
    return execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf-8' }).trim()
  } catch {
    return ''
  }
}

/**
 * Resolve a task variable name to its string value using the provided context.
 *
 * @param name - The variable identifier (the content inside `${...}`, e.g. `file`, `env:PATH`, or `input:id`)
 * @param ctx - Resolution context providing workspace, file, selection, environment, git and pre-resolved input values
 * @returns The resolved string for `name`, or the original `${name}` placeholder if no value is available
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
      const prefix = ctx.workspaceRoot.endsWith('/') ? ctx.workspaceRoot : `${ctx.workspaceRoot}/`
      const rel = ctx.activeFile.startsWith(prefix)
        ? ctx.activeFile.slice(prefix.length)
        : ctx.activeFile
      return rel
    }
    case 'fileBasename':
      return ctx.activeFile?.split('/').pop() ?? ''
    case 'fileExtname': {
      const base = ctx.activeFile?.split('/').pop() ?? ''
      const dotIdx = base.lastIndexOf('.')
      return dotIdx > 0 ? base.slice(dotIdx) : ''
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
 * Replaces all `${...}` placeholders in `template` using values from `ctx`.
 *
 * @param template - The string containing `${variable}` placeholders
 * @param ctx - Resolution context providing workspace, file, environment, git, datetime, and input values
 * @returns The input string with all `${...}` placeholders substituted with resolved values
 */
export function resolveVariables(template: string, ctx: TaskVariableContext): string {
  return template.replace(VARIABLE_RE, (_match, name: string) => resolveVariable(name, ctx))
}

/**
 * Collects all `${input:id}` references used in the provided task fields.
 *
 * @returns A de-duplicated array of input `id` strings found in the task's `command`, `args`, `cwd`, `promptBefore`, and `env` values.
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
