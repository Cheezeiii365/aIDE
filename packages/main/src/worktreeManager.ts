import { ipcMain } from 'electron'
import simpleGit from 'simple-git'
import { resolve, basename } from 'path'
import { mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { IpcChannels } from '@aide/shared'
import type { WorktreeInfo, WorktreeCreateOpts, AppSettings } from '@aide/shared'
import type Store from 'electron-store'
import { startGitPolling } from './gitStatus'
import { startWatchers } from './fileWatcher'

let pollTimer: ReturnType<typeof setInterval> | null = null
let cachedList: WorktreeInfo[] = []
let lastJson = ''
let currentRepoRoot: string | null = null

type GetWebContents = () => Electron.WebContents | null

/**
 * Produce a filesystem-safe branch name by replacing path separators and removing invalid characters.
 *
 * @param branch - The original branch name
 * @returns The sanitized branch name where `/` and `\` are replaced with `-` and only `a-z`, `A-Z`, `0-9`, `.`, `_`, and `-` remain
 */
function sanitizeBranchName(branch: string): string {
  return branch.replace(/[/\\]/g, '-').replace(/[^a-zA-Z0-9._-]/g, '')
}

/**
 * Parse the stdout of `git worktree list --porcelain` into an array of worktree descriptors.
 *
 * @param output - Raw `--porcelain` output from `git worktree list`
 * @param activeWorktree - Absolute path of the active worktree to mark as current, or `null`
 * @returns An array of `WorktreeInfo` objects where each entry includes `path`, `branch` (branch name or `'HEAD'`), `isMain` (first non-bare entry), `isDirty` (initialized to `false`), and `isCurrent` (`true` when `path` equals `activeWorktree`)
 */
function parseWorktreeListPorcelain(output: string, activeWorktree: string | null): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = []
  const blocks = output.trim().split('\n\n')

  for (const block of blocks) {
    if (!block.trim()) continue
    const lines = block.trim().split('\n')
    let path = ''
    let branch = ''
    let isMain = false

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        path = line.slice('worktree '.length)
      } else if (line.startsWith('branch ')) {
        // e.g. "branch refs/heads/main" → "main"
        branch = line.slice('branch '.length).replace('refs/heads/', '')
      } else if (line === 'bare') {
        // Skip bare worktrees
        path = ''
        break
      } else if (line.startsWith('HEAD ') && !branch) {
        // Detached HEAD — use short SHA
        branch = line.slice('HEAD '.length, 'HEAD '.length + 7)
      }
    }

    if (!path) continue

    // First worktree in the list is always the main one
    if (worktrees.length === 0) isMain = true

    worktrees.push({
      path,
      branch: branch || 'HEAD',
      isMain,
      isDirty: false, // filled in later
      isCurrent: path === activeWorktree,
    })
  }

  return worktrees
}

/**
 * Updates each worktree's `isDirty` property by checking the Git status at the worktree path.
 *
 * @param worktrees - Array of worktree entries whose `isDirty` property will be set to `true` when the worktree has uncommitted changes, or `false` when clean or if the status check fails.
 */
async function checkDirtyStatus(worktrees: WorktreeInfo[]): Promise<void> {
  for (const wt of worktrees) {
    try {
      const git = simpleGit(wt.path)
      const status = await git.status()
      wt.isDirty = !status.isClean()
    } catch {
      wt.isDirty = false
    }
  }
}

/**
 * Retrieve and augment the list of Git worktrees for a repository root.
 *
 * Fetches `git worktree list --porcelain`, parses the output into `WorktreeInfo`
 * entries, marks the entry matching `activeWorktree` as current, and updates each
 * entry's `isDirty` by checking the worktree status.
 *
 * @param repoRoot - Filesystem path to the repository root to query
 * @param activeWorktree - Path of the currently active worktree, or `null` if none
 * @returns An array of `WorktreeInfo` objects for the repository; returns an empty array if `repoRoot` is not a Git repository or if an error occurs
 */
async function fetchWorktreeList(
  repoRoot: string,
  activeWorktree: string | null,
): Promise<WorktreeInfo[]> {
  try {
    const git = simpleGit(repoRoot)
    const isRepo = await git.checkIsRepo()
    if (!isRepo) return []

    const output = await git.raw(['worktree', 'list', '--porcelain'])
    const worktrees = parseWorktreeListPorcelain(output, activeWorktree)
    await checkDirtyStatus(worktrees)
    return worktrees
  } catch {
    return []
  }
}

/**
 * Compute the directory used to store worktrees for a repository.
 *
 * @param repoRoot - Path to the repository root
 * @returns The path to the worktree storage directory (resolved as `../.aide-worktrees` relative to `repoRoot`)
 */
function getWorktreeDir(repoRoot: string): string {
  return resolve(repoRoot, '..', '.aide-worktrees')
}

/**
 * Register Electron IPC handlers for managing Git worktrees and keep internal cache and renderer synced.
 *
 * Registers handlers for listing worktrees, creating and removing worktrees, setting/getting the active
 * worktree, and listing branches. Handlers update the module's cached worktree list, emit
 * WORKTREE_LIST_CHANGED to the renderer when the list changes, and coordinate watcher/polling lifecycle
 * when the active worktree changes.
 */
export function registerWorktreeHandlers(
  getWebContents: GetWebContents,
  store: Store<AppSettings>,
): void {
  ipcMain.handle(IpcChannels.WORKTREE_LIST, async () => {
    if (!currentRepoRoot) return []
    const active = store.get('activeWorktree')
    cachedList = await fetchWorktreeList(currentRepoRoot, active)
    return cachedList
  })

  ipcMain.handle(
    IpcChannels.WORKTREE_CREATE,
    async (_event, opts: WorktreeCreateOpts): Promise<{ path: string } | { error: string }> => {
      if (!currentRepoRoot) return { error: 'No workspace open' }

      try {
        const git = simpleGit(currentRepoRoot)
        const worktreeDir = getWorktreeDir(currentRepoRoot)
        const dirName = sanitizeBranchName(opts.branch)
        const targetPath = resolve(worktreeDir, dirName)

        // Ensure parent directory exists
        await mkdir(worktreeDir, { recursive: true })

        if (opts.createBranch) {
          const base = opts.baseBranch || 'HEAD'
          await git.raw(['worktree', 'add', '-b', opts.branch, targetPath, base])
        } else {
          await git.raw(['worktree', 'add', targetPath, opts.branch])
        }

        // Refresh the cached list
        const active = store.get('activeWorktree')
        cachedList = await fetchWorktreeList(currentRepoRoot, active)
        getWebContents()?.send(IpcChannels.WORKTREE_LIST_CHANGED, cachedList)

        return { path: targetPath }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error creating worktree'
        return { error: message }
      }
    },
  )

  ipcMain.handle(
    IpcChannels.WORKTREE_REMOVE,
    async (_event, worktreePath: string): Promise<{ success: true } | { error: string }> => {
      if (!currentRepoRoot) return { error: 'No workspace open' }

      try {
        const git = simpleGit(currentRepoRoot)
        await git.raw(['worktree', 'remove', worktreePath, '--force'])

        // If active worktree was removed, reset to main
        const active = store.get('activeWorktree')
        if (active === worktreePath) {
          store.set('activeWorktree', null)
          // Restart file watcher and git polling on main repo root
          await startWatchers('default', [currentRepoRoot])
          await startGitPolling(currentRepoRoot, getWebContents)
        }

        // Refresh the cached list
        const newActive = store.get('activeWorktree')
        cachedList = await fetchWorktreeList(currentRepoRoot, newActive)
        getWebContents()?.send(IpcChannels.WORKTREE_LIST_CHANGED, cachedList)

        return { success: true }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error removing worktree'
        return { error: message }
      }
    },
  )

  ipcMain.handle(
    IpcChannels.WORKTREE_SET_ACTIVE,
    async (_event, worktreePath: string | null): Promise<void> => {
      store.set('activeWorktree', worktreePath)

      // Watch both repo root and active worktree (or just repo root if null)
      const roots = worktreePath
        ? [currentRepoRoot!, worktreePath]
        : [currentRepoRoot!]
      await startWatchers('default', roots)

      // Git polling uses the effective root for status
      const effectiveRoot = worktreePath || currentRepoRoot
      if (effectiveRoot) {
        await startGitPolling(effectiveRoot, getWebContents)
      }

      // Update isCurrent flags and notify renderer
      if (currentRepoRoot) {
        cachedList = await fetchWorktreeList(currentRepoRoot, worktreePath)
        getWebContents()?.send(IpcChannels.WORKTREE_LIST_CHANGED, cachedList)
      }
    },
  )

  ipcMain.handle(IpcChannels.WORKTREE_GET_ACTIVE, () => {
    return store.get('activeWorktree')
  })

  ipcMain.handle(IpcChannels.WORKTREE_LIST_BRANCHES, async (): Promise<string[]> => {
    if (!currentRepoRoot) return []
    try {
      const git = simpleGit(currentRepoRoot)
      const output = await git.raw(['branch', '-a', '--format=%(refname:short)'])
      return output
        .split('\n')
        .map((b) => b.trim())
        .filter(Boolean)
    } catch {
      return []
    }
  })
}

/**
 * Start polling the repository's worktrees and emit updates when the list changes.
 *
 * Stops any existing poller, sets the polling root, performs an initial fetch of the worktree list,
 * and then periodically refreshes the list (every 5000ms). When the serialized list differs from the
 * previous snapshot, broadcasts IpcChannels.WORKTREE_LIST_CHANGED with the new list and updates module-level cache.
 *
 * @param repoRoot - Filesystem path to the repository to poll
 * @param getWebContents - Function that returns the current Electron WebContents used to send IPC updates
 * @param store - Application settings store (used to read the active worktree)
 */
export async function startWorktreePolling(
  repoRoot: string,
  getWebContents: GetWebContents,
  store: Store<AppSettings>,
): Promise<void> {
  stopWorktreePolling()
  currentRepoRoot = repoRoot
  lastJson = ''

  // Initial fetch
  const active = store.get('activeWorktree')
  cachedList = await fetchWorktreeList(repoRoot, active)
  lastJson = JSON.stringify(cachedList)

  pollTimer = setInterval(async () => {
    const currentActive = store.get('activeWorktree')
    const list = await fetchWorktreeList(repoRoot, currentActive)
    const json = JSON.stringify(list)

    if (json !== lastJson) {
      lastJson = json
      cachedList = list
      getWebContents()?.send(IpcChannels.WORKTREE_LIST_CHANGED, list)
    }
  }, 5000)
}

/**
 * Stop the periodic worktree polling, clear its timer, and reset cached worktree state.
 *
 * Clears the polling interval (if running) and resets `currentRepoRoot`, `lastJson`, and `cachedList`.
 */
export function stopWorktreePolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  currentRepoRoot = null
  lastJson = ''
  cachedList = []
}
