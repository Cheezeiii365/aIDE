import { spawn, type ChildProcess } from 'child_process'
import { rgPath } from '@vscode/ripgrep'
import type { SearchOpts, SearchMatch, SearchFileResult, SearchResultsPayload, SearchCompletePayload } from '@aide/shared'

let activeSearch: ChildProcess | null = null

/**
 * Stops any currently running ripgrep search and clears the active process handle.
 *
 * This will terminate the child process tracked by the module and reset the internal
 * `activeSearch` reference to `null`.
 */
export function cancelSearch(): void {
  if (activeSearch) {
    activeSearch.kill()
    activeSearch = null
  }
}

/**
 * Start a ripgrep-based search using the provided options and stream parsed match results to callbacks.
 *
 * The function cancels any previously running search, spawns ripgrep with JSON output, incrementally parses
 * newline-delimited JSON match events, accumulates matches per file, and emits batched per-file results to
 * `onResults` (debounced ~100ms). Malformed JSON lines from ripgrep are ignored. When the ripgrep process
 * finishes or errors, `onComplete` is invoked with summary totals.
 *
 * @param opts - Search options (query, rootPath, case sensitivity, whole-word, regex vs fixed-strings, optional file glob)
 * @param onResults - Called with workspace-scoped incremental per-file results
 * @param onComplete - Called once when the search process ends or errors
 */
export function startSearch(
  opts: SearchOpts,
  onResults: (payload: SearchResultsPayload) => void,
  onComplete: (payload: SearchCompletePayload) => void,
  excludeGlobs?: string[],
): void {
  cancelSearch()

  const args = ['--json', '--line-number', '--column']

  if (!opts.caseSensitive) args.push('--ignore-case')
  if (opts.wholeWord) args.push('--word-regexp')
  if (!opts.isRegex) args.push('--fixed-strings')
  if (opts.fileGlob) args.push('--glob', opts.fileGlob)
  if (excludeGlobs) {
    for (const glob of excludeGlobs) {
      args.push('--glob', `!${glob}`)
    }
  }

  args.push('--', opts.query, opts.rootPath)

  const proc = spawn(rgPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  activeSearch = proc

  let totalMatches = 0
  const seenFiles = new Set<string>()
  const fileMap = new Map<string, SearchMatch[]>()
  let buffer = ''
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  function flush() {
    if (fileMap.size === 0) return
    const results: SearchFileResult[] = []
    for (const [filePath, matches] of fileMap) {
      results.push({ filePath, matches })
    }
    fileMap.clear()
    onResults({ workspaceId: opts.workspaceId, results })
  }

  function scheduleFlush() {
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      flush()
    }, 100)
  }

  proc.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line)
        if (msg.type === 'match') {
          const filePath: string = msg.data.path.text
          const lineNum: number = msg.data.line_number
          const lineText: string = msg.data.lines.text.replace(/\n$/, '')

          for (const sub of msg.data.submatches) {
            const match: SearchMatch = {
              line: lineNum,
              column: sub.start + 1,
              lineText,
              matchText: sub.match.text,
            }
            totalMatches++
            seenFiles.add(filePath)

            let list = fileMap.get(filePath)
            if (!list) {
              list = []
              fileMap.set(filePath, list)
            }
            list.push(match)
          }
          scheduleFlush()
        }
      } catch {
        // skip malformed JSON lines
      }
    }
  })

  proc.on('close', () => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    flush()
    onComplete({
      workspaceId: opts.workspaceId,
      totalMatches,
      totalFiles: seenFiles.size,
    })
    if (activeSearch === proc) activeSearch = null
  })

  proc.on('error', () => {
    onComplete({
      workspaceId: opts.workspaceId,
      totalMatches: 0,
      totalFiles: 0,
    })
    if (activeSearch === proc) activeSearch = null
  })
}
