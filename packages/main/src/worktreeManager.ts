import { ipcMain } from 'electron'
import simpleGit from 'simple-git'
import { resolve, basename } from 'path'
import { mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { IpcChannels } from '@aide/shared'
import type { WorktreeInfo, WorktreeCreateOpts, AppSettings } from '@aide/shared'
import type Store from 'electron-store'
import { startGitPolling } from './gitStatus'
import { startWatcher } from './fileWatcher'

let pollTimer: ReturnType<typeof setInterval> | null = null
let cachedList: WorktreeInfo[] = []
let lastJson = ''
let currentRepoRoot: string | null = null

type GetWebContents = () => Electron.WebContents | null

function sanitizeBranchName(branch: string): string {
  return branch.replace(/[/\\]/g, '-').replace(/[^a-zA-Z0-9._-]/g, '')
}

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

function getWorktreeDir(repoRoot: string): string {
  return resolve(repoRoot, '..', '.aide-worktrees')
}

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
          await startWatcher(currentRepoRoot)
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

      // Switch file watcher and git polling to the new root
      const effectiveRoot = worktreePath || currentRepoRoot
      if (effectiveRoot) {
        await startWatcher(effectiveRoot)
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

export function stopWorktreePolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  currentRepoRoot = null
  lastJson = ''
  cachedList = []
}
