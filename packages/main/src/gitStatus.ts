import { ipcMain } from 'electron'
import simpleGit from 'simple-git'
import { IpcChannels } from '@aide/shared'
import type { GitFileStatus, GitStatusResult } from '@aide/shared'

let pollTimer: ReturnType<typeof setInterval> | null = null
let currentRoot: string | null = null
let lastJson = ''
let lastBranch = ''
let lastIgnoredJson = ''

type GetWebContents = () => Electron.WebContents | null

/**
 * Obtains Git status for the repository at the given root path.
 *
 * @param rootPath - Absolute path to the Git working tree root to inspect
 * @returns A result containing a map of absolute file paths to single-letter Git status codes (`'D'`, `'?'`, `'A'`, `'M'`), the current branch name (or `'HEAD'` if unavailable), and an array of absolute ignored paths; `null` if the path is not a Git repository or if an error occurs.
 */
async function fetchGitStatus(rootPath: string): Promise<GitStatusResult | null> {
  try {
    const git = simpleGit(rootPath)
    const isRepo = await git.checkIsRepo()
    if (!isRepo) return null

    const status = await git.status()
    const files: Record<string, GitFileStatus> = {}

    for (const f of status.deleted) {
      files[`${rootPath}/${f}`] = 'D'
    }
    for (const f of status.not_added) {
      files[`${rootPath}/${f}`] = '?'
    }
    for (const f of status.created) {
      files[`${rootPath}/${f}`] = 'A'
    }
    for (const f of status.modified) {
      files[`${rootPath}/${f}`] = 'M'
    }
    for (const f of status.conflicted) {
      files[`${rootPath}/${f}`] = 'C'
    }

    // Fetch gitignored paths (directories listed as single entries via --directory)
    let ignoredPaths: string[] = []
    try {
      const ignoredRaw = await git.raw([
        'ls-files', '--others', '--ignored', '--exclude-standard', '--directory',
      ])
      ignoredPaths = ignoredRaw
        .split('\n')
        .filter(Boolean)
        .map((f) => `${rootPath}/${f.replace(/\/$/, '')}`)
    } catch {
      // Non-fatal: ignored paths are a nice-to-have
    }

    return { files, branch: status.current ?? 'HEAD', ignoredPaths }
  } catch {
    return null
  }
}

/**
 * Register an IPC handler that provides Git status for the currently selected repository root.
 *
 * The handler listens on IpcChannels.GIT_STATUS and, when invoked, returns `null` if no repository
 * root is set or the result of `fetchGitStatus(currentRoot)` otherwise.
 */
export function registerGitStatusHandlers(getWebContents: GetWebContents): void {
  ipcMain.handle(IpcChannels.GIT_STATUS, async () => {
    if (!currentRoot) return null
    return fetchGitStatus(currentRoot)
  })
}

/**
 * Start polling the Git repository at `rootPath` for status changes and emit IPC events when changes occur.
 *
 * Performs an initial status fetch, replaces any existing poll, and then polls every 3000 ms. When the repository's
 * file status map or ignored path list changes, sends `IpcChannels.GIT_STATUS_CHANGED` with the full status result.
 * When the current branch changes, sends `IpcChannels.GIT_BRANCH_CHANGED` with the new branch name.
 *
 * @param rootPath - Absolute path to the Git repository root to monitor
 * @param getWebContents - Function that returns the Electron WebContents used to send IPC messages (may return `null`)
 */
export async function startGitPolling(
  rootPath: string,
  getWebContents: GetWebContents,
): Promise<void> {
  stopGitPolling()
  currentRoot = rootPath
  lastJson = ''
  lastBranch = ''
  lastIgnoredJson = ''

  // Initial fetch
  const initial = await fetchGitStatus(rootPath)
  if (initial) {
    lastJson = JSON.stringify(initial.files)
    lastBranch = initial.branch
    lastIgnoredJson = JSON.stringify(initial.ignoredPaths)
  }

  pollTimer = setInterval(async () => {
    const result = await fetchGitStatus(rootPath)
    if (!result) return

    const wc = getWebContents()
    if (!wc) return

    const json = JSON.stringify(result.files)
    const ignoredJson = JSON.stringify(result.ignoredPaths)
    if (json !== lastJson || ignoredJson !== lastIgnoredJson) {
      lastJson = json
      lastIgnoredJson = ignoredJson
      wc.send(IpcChannels.GIT_STATUS_CHANGED, result)
    }

    if (result.branch !== lastBranch) {
      lastBranch = result.branch
      wc.send(IpcChannels.GIT_BRANCH_CHANGED, result.branch)
    }
  }, 3000)
}

/**
 * Stops the active Git polling timer and resets cached repository state.
 *
 * Clears any existing polling interval, sets the current Git root to `null`,
 * and clears cached file, branch, and ignored-path data.
 */
export function stopGitPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  currentRoot = null
  lastJson = ''
  lastBranch = ''
  lastIgnoredJson = ''
}
