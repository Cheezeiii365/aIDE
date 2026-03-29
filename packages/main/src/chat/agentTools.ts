import { stat, readFile, writeFile, mkdir, readdir } from 'fs/promises'
import { dirname, join, relative } from 'path'
import { execFile, spawn } from 'child_process'
import { rgPath } from '@vscode/ripgrep'
import type { ToolDefinition, ChatMode } from '@aide/shared'
import { fetchGitStatus } from '../git/gitStatus'
import type { BrowserPaneManager } from '../browserPaneManager'

// ─── Context & Types ────────────────────────────────────────────────

export interface ToolContext {
  workspaceRoot: string
  /** Effective root directory — worktree path if set, otherwise workspaceRoot. */
  effectiveRoot?: string
  workspaceId?: string
  workingSet?: string[]
  browserPaneManager?: BrowserPaneManager
}

export interface BuiltinTool {
  definition: ToolDefinition
  modes: ChatMode[]
  execute: (input: Record<string, unknown>, context: ToolContext) => Promise<string>
}

// ─── Helpers ────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const MAX_OUTPUT = 100 * 1024 // 100 KB

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
}

function detectShell(): string {
  if (process.platform === 'win32') return 'powershell.exe'
  return process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  return text.slice(0, limit) + `\n\n... (truncated, ${text.length} total characters)`
}

function execFilePromise(
  cmd: string,
  args: string[],
  options: { cwd?: string; timeout?: number; maxBuffer?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = execFile(
      cmd,
      args,
      { cwd: options.cwd, timeout: options.timeout, maxBuffer: options.maxBuffer ?? 5 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && proc.exitCode === null) {
          reject(error)
          return
        }
        resolve({
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : '',
          exitCode: proc.exitCode ?? (error ? 1 : 0),
        })
      },
    )
  })
}

// ─── Tool Definitions ───────────────────────────────────────────────

const fileRead: BuiltinTool = {
  definition: {
    name: 'file_read',
    description: 'Read the contents of a file. Supports optional line offset and limit for reading portions of large files.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file to read' },
        offset: { type: 'integer', description: 'Line number to start reading from (1-based)', minimum: 1 },
        limit: { type: 'integer', description: 'Maximum number of lines to return', minimum: 1 },
      },
      required: ['path'],
    },
    source: 'builtin',
  },
  modes: ['ask', 'edit', 'agent'],
  async execute(input, _context) {
    const filePath = input.path as string
    const offset = input.offset as number | undefined
    const limit = input.limit as number | undefined

    const info = await stat(filePath)
    if (!info.isFile()) throw new Error(`Not a file: ${filePath}`)
    if (info.size > MAX_FILE_SIZE) throw new Error(`File too large (${info.size} bytes, max ${MAX_FILE_SIZE})`)

    const content = await readFile(filePath, 'utf-8')
    const sample = content.slice(0, 8192)
    if (sample.includes('\0')) throw new Error('Binary file — cannot read as text')

    if (offset !== undefined || limit !== undefined) {
      const lines = content.split('\n')
      const start = (offset ?? 1) - 1
      const end = limit !== undefined ? start + limit : lines.length
      return lines.slice(start, end).join('\n')
    }

    return content
  },
}

const fileWrite: BuiltinTool = {
  definition: {
    name: 'file_write',
    description: 'Write content to a file, creating it if it does not exist. Optionally creates parent directories.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to write to' },
        content: { type: 'string', description: 'Content to write to the file' },
        createDirectories: { type: 'boolean', description: 'Create parent directories if they do not exist', default: false },
      },
      required: ['path', 'content'],
    },
    source: 'builtin',
  },
  modes: ['edit', 'agent'],
  async execute(input, _context) {
    const filePath = input.path as string
    const content = input.content as string
    const createDirs = input.createDirectories as boolean | undefined

    if (createDirs) {
      await mkdir(dirname(filePath), { recursive: true })
    }

    await writeFile(filePath, content, 'utf-8')
    return `File written successfully: ${filePath}`
  },
}

const fileList: BuiltinTool = {
  definition: {
    name: 'file_list',
    description: 'List files and directories. Non-recursive lists the immediate contents; recursive uses git ls-files for efficiency.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the directory to list' },
        recursive: { type: 'boolean', description: 'List files recursively', default: false },
      },
      required: ['path'],
    },
    source: 'builtin',
  },
  modes: ['ask', 'edit', 'agent'],
  async execute(input, _context) {
    const dirPath = input.path as string
    const recursive = input.recursive as boolean | undefined

    if (recursive) {
      try {
        const { stdout } = await execFilePromise('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
          cwd: dirPath,
        })
        return stdout.trim() || '(empty directory)'
      } catch {
        // Fallback: simple recursive readdir
        return await recursiveList(dirPath, dirPath)
      }
    }

    const entries = await readdir(dirPath, { withFileTypes: true })
    const HIDDEN = new Set(['.git', '.DS_Store', 'Thumbs.db'])
    const filtered = entries.filter((e) => !HIDDEN.has(e.name))
    filtered.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
    return filtered
      .map((e) => (e.isDirectory() ? `[dir] ${e.name}` : `      ${e.name}`))
      .join('\n') || '(empty directory)'
  },
}

async function recursiveList(dirPath: string, rootPath: string): Promise<string> {
  const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'out', '__pycache__'])
  const results: string[] = []

  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else {
        results.push(relative(rootPath, full))
      }
    }
  }

  await walk(dirPath)
  return results.join('\n') || '(empty directory)'
}

const terminalExec: BuiltinTool = {
  definition: {
    name: 'terminal_exec',
    description: 'Execute a shell command and return its output. Use for running builds, tests, scripts, and other command-line operations.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        cwd: { type: 'string', description: 'Working directory (defaults to workspace root)' },
        timeout: { type: 'integer', description: 'Timeout in milliseconds (default 30000, max 120000)', default: 30000, maximum: 120000 },
      },
      required: ['command'],
    },
    source: 'builtin',
  },
  modes: ['agent'],
  async execute(input, context) {
    const command = input.command as string
    const cwd = (input.cwd as string | undefined) || (context.effectiveRoot ?? context.workspaceRoot)
    const timeout = Math.min((input.timeout as number | undefined) ?? 30000, 120000)
    const shell = detectShell()

    const { stdout, stderr, exitCode } = await execFilePromise(
      shell,
      ['-c', command],
      { cwd, timeout, maxBuffer: 5 * 1024 * 1024 },
    )

    const output = stripAnsi([stdout, stderr].filter(Boolean).join('\n'))
    return truncate(`Exit code: ${exitCode}\n\n${output}`, MAX_OUTPUT)
  },
}

const searchFiles: BuiltinTool = {
  definition: {
    name: 'search_files',
    description: 'Search file contents using ripgrep. Returns matching lines with file paths and line numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (text or regex)' },
        path: { type: 'string', description: 'Directory to search in (defaults to workspace root)' },
        isRegex: { type: 'boolean', description: 'Treat query as regex', default: false },
        caseSensitive: { type: 'boolean', description: 'Case-sensitive search', default: false },
        fileGlob: { type: 'string', description: "File glob pattern to filter (e.g. '*.ts')" },
        maxResults: { type: 'integer', description: 'Maximum number of matches to return', default: 50 },
      },
      required: ['query'],
    },
    source: 'builtin',
  },
  modes: ['ask', 'edit', 'agent'],
  execute(input, context) {
    const query = input.query as string
    const searchPath = (input.path as string | undefined) || (context.effectiveRoot ?? context.workspaceRoot)
    const isRegex = input.isRegex as boolean | undefined
    const caseSensitive = input.caseSensitive as boolean | undefined
    const fileGlob = input.fileGlob as string | undefined
    const maxResults = (input.maxResults as number | undefined) ?? 50

    return new Promise((resolve, reject) => {
      const args = ['--json', '--line-number', '--column']
      if (!caseSensitive) args.push('--ignore-case')
      if (!isRegex) args.push('--fixed-strings')
      if (fileGlob) args.push('--glob', fileGlob)
      args.push('--', query, searchPath)

      const proc = spawn(rgPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })

      let matchCount = 0
      const lines: string[] = []
      let buffer = ''

      proc.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const parts = buffer.split('\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          if (!part.trim()) continue
          try {
            const msg = JSON.parse(part)
            if (msg.type === 'match' && matchCount < maxResults) {
              const filePath: string = msg.data.path.text
              const lineNum: number = msg.data.line_number
              const lineText: string = msg.data.lines.text.replace(/\n$/, '')
              lines.push(`${filePath}:${lineNum}: ${lineText}`)
              matchCount++
              if (matchCount >= maxResults) proc.kill()
            }
          } catch {
            // skip malformed lines
          }
        }
      })

      proc.on('close', () => {
        if (lines.length === 0) {
          resolve('No matches found.')
          return
        }
        const header = matchCount >= maxResults
          ? `Found ${matchCount}+ matches (showing first ${maxResults}):\n\n`
          : `Found ${matchCount} match${matchCount === 1 ? '' : 'es'}:\n\n`
        resolve(header + lines.join('\n'))
      })

      proc.on('error', (err) => {
        reject(new Error(`Search failed: ${err.message}`))
      })
    })
  },
}

const gitStatus: BuiltinTool = {
  definition: {
    name: 'git_status',
    description: 'Get the current git status showing branch name and modified/staged/untracked files.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repository path (defaults to workspace root)' },
      },
    },
    source: 'builtin',
  },
  modes: ['ask', 'edit', 'agent'],
  async execute(input, context) {
    const rootPath = (input.path as string | undefined) || (context.effectiveRoot ?? context.workspaceRoot)
    const result = await fetchGitStatus(rootPath)
    if (!result) return 'Not a git repository'

    const lines = [`Branch: ${result.branch}`]
    for (const [filePath, status] of Object.entries(result.files)) {
      lines.push(`${status} ${relative(rootPath, filePath)}`)
    }
    if (lines.length === 1) lines.push('(clean working tree)')
    return lines.join('\n')
  },
}

const gitDiff: BuiltinTool = {
  definition: {
    name: 'git_diff',
    description: 'Show git diff output. Can diff working tree, staged changes, or against a specific commit.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to diff (omit for entire repo)' },
        staged: { type: 'boolean', description: 'Show staged changes only', default: false },
        commit: { type: 'string', description: 'Commit ref to diff against (default: working tree vs HEAD)' },
      },
    },
    source: 'builtin',
  },
  modes: ['ask', 'edit', 'agent'],
  async execute(input, context) {
    const filePath = input.path as string | undefined
    const staged = input.staged as boolean | undefined
    const commit = input.commit as string | undefined

    const args = ['diff']
    if (staged) args.push('--cached')
    if (commit) args.push(commit)
    if (filePath) args.push('--', filePath)

    const { stdout } = await execFilePromise('git', args, { cwd: context.effectiveRoot ?? context.workspaceRoot })
    if (!stdout.trim()) return 'No differences found.'
    return truncate(stdout, MAX_OUTPUT)
  },
}

const browserRead: BuiltinTool = {
  definition: {
    name: 'browser_read',
    description: 'Read the text content of an open browser pane. Useful for inspecting web pages the user has open.',
    inputSchema: {
      type: 'object',
      properties: {
        paneId: { type: 'string', description: 'Browser pane ID to read from (uses first available if omitted)' },
        selector: { type: 'string', description: 'CSS selector to scope content extraction' },
      },
    },
    source: 'builtin',
  },
  modes: ['ask', 'edit', 'agent'],
  async execute(input, context) {
    if (!context.browserPaneManager) return 'No browser pane manager available.'

    const paneId = input.paneId as string | undefined
    const selector = input.selector as string | undefined
    const content = await context.browserPaneManager.getPageContent(paneId, selector, context.workspaceId)
    if (content === null) return 'No browser pane is currently open.'
    if (!content) return '(empty page content)'
    return truncate(content, MAX_OUTPUT)
  },
}

// ─── Exports ────────────────────────────────────────────────────────

export const BUILTIN_TOOLS: BuiltinTool[] = [
  fileRead,
  fileWrite,
  fileList,
  terminalExec,
  searchFiles,
  gitStatus,
  gitDiff,
  browserRead,
]
