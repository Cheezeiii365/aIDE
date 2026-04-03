import { ipcMain } from 'electron'
import simpleGit from 'simple-git'
import { resolve } from 'path'
import { mkdir } from 'fs/promises'
import { IpcChannels } from '@aide/shared'
import type { WorktreeInfo, WorktreeCreateOpts, WorktreeListChangedPayload } from '@aide/shared'
import { startGitPollingForWorkspace } from '../git/gitStatus'
import { startWatchers } from './fileWatcher'

/** Per-workspace selected worktree path (not the main repo root). */
const activeWorktreeByWorkspaceId = new Map<string, string | null>()

type GetWebContents = () => Electron.WebContents | null
export type GetWorkspaceRepoRoot = (workspaceId: string) => string | null

interface WorktreePollEntry {
  pollTimer: ReturnType<typeof setInterval>
  repoRoot: string
  lastJson: string
}

const worktreePollByWorkspaceId = new Map<string, WorktreePollEntry>()

export function getActiveWorktreeForWorkspace(workspaceId: string): string | null {
  return activeWorktreeByWorkspaceId.get(workspaceId) ?? null
}

export function setActiveWorktreeForWorkspace(workspaceId: string, path: string | null): void {
  activeWorktreeByWorkspaceId.set(workspaceId, path)
}

function worktreeListPayload(workspaceId: string, worktrees: WorktreeInfo[]): WorktreeListChangedPayload {
  return { workspaceId, worktrees }
}

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
        branch = line.slice('branch '.length).replace('refs/heads/', '')
      } else if (line === 'bare') {
        path = ''
        break
      } else if (line.startsWith('HEAD ') && !branch) {
        branch = line.slice('HEAD '.length, 'HEAD '.length + 7)
      }
    }

    if (!path) continue
    if (worktrees.length === 0) isMain = true

    worktrees.push({
      path,
      branch: branch || 'HEAD',
      isMain,
      isDirty: false,
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

export async function fetchWorktreeList(
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

/**
 * Register worktree IPC handlers keyed by `workspaceId`.
 */
export function registerWorktreeHandlers(
  getWebContents: GetWebContents,
  getRepoRoot: GetWorkspaceRepoRoot,
): void {
  ipcMain.handle(IpcChannels.WORKTREE_LIST, async (_event, workspaceId: string) => {
    const root = getRepoRoot(workspaceId)
    if (!root) return []
    const active = getActiveWorktreeForWorkspace(workspaceId)
    return fetchWorktreeList(root, active)
  })

  ipcMain.handle(
    IpcChannels.WORKTREE_CREATE,
    async (
      _event,
      workspaceId: string,
      opts: WorktreeCreateOpts,
    ): Promise<{ path: string } | { error: string }> => {
      const currentRepoRoot = getRepoRoot(workspaceId)
      if (!currentRepoRoot) return { error: 'No workspace open' }

      try {
        const git = simpleGit(currentRepoRoot)
        const worktreeDir = getWorktreeDir(currentRepoRoot)
        const dirName = sanitizeBranchName(opts.branch)
        const targetPath = resolve(worktreeDir, dirName)

        await mkdir(worktreeDir, { recursive: true })

        if (opts.createBranch) {
          const base = opts.baseBranch || 'HEAD'
          await git.raw(['worktree', 'add', '-b', opts.branch, targetPath, base])
        } else {
          await git.raw(['worktree', 'add', targetPath, opts.branch])
        }

        const active = getActiveWorktreeForWorkspace(workspaceId)
        const list = await fetchWorktreeList(currentRepoRoot, active)
        getWebContents()?.send(IpcChannels.WORKTREE_LIST_CHANGED, worktreeListPayload(workspaceId, list))

        return { path: targetPath }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error creating worktree'
        return { error: message }
      }
    },
  )

  ipcMain.handle(
    IpcChannels.WORKTREE_REMOVE,
    async (_event, workspaceId: string, worktreePath: string): Promise<{ success: true } | { error: string }> => {
      const currentRepoRoot = getRepoRoot(workspaceId)
      if (!currentRepoRoot) return { error: 'No workspace open' }

      try {
        const git = simpleGit(currentRepoRoot)
        await git.raw(['worktree', 'remove', worktreePath, '--force'])

        const active = getActiveWorktreeForWorkspace(workspaceId)
        if (active === worktreePath) {
          setActiveWorktreeForWorkspace(workspaceId, null)
          await startWatchers(workspaceId, [currentRepoRoot])
          await startGitPollingForWorkspace(workspaceId, currentRepoRoot, getWebContents)
        }

        const newActive = getActiveWorktreeForWorkspace(workspaceId)
        const list = await fetchWorktreeList(currentRepoRoot, newActive)
        getWebContents()?.send(IpcChannels.WORKTREE_LIST_CHANGED, worktreeListPayload(workspaceId, list))

        return { success: true }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error removing worktree'
        return { error: message }
      }
    },
  )

  ipcMain.handle(
    IpcChannels.WORKTREE_SET_ACTIVE,
    async (_event, workspaceId: string, worktreePath: string | null): Promise<void> => {
      const currentRepoRoot = getRepoRoot(workspaceId)
      if (!currentRepoRoot) return

      setActiveWorktreeForWorkspace(workspaceId, worktreePath)

      const roots = worktreePath ? [currentRepoRoot, worktreePath] : [currentRepoRoot]
      await startWatchers(workspaceId, roots)

      const effectiveRoot = worktreePath || currentRepoRoot
      await startGitPollingForWorkspace(workspaceId, effectiveRoot, getWebContents)

      const list = await fetchWorktreeList(currentRepoRoot, worktreePath)
      getWebContents()?.send(IpcChannels.WORKTREE_LIST_CHANGED, worktreeListPayload(workspaceId, list))
    },
  )

  ipcMain.handle(IpcChannels.WORKTREE_GET_ACTIVE, (_event, workspaceId: string) => {
    return getActiveWorktreeForWorkspace(workspaceId)
  })

  ipcMain.handle(IpcChannels.WORKTREE_LIST_BRANCHES, async (_event, workspaceId: string): Promise<string[]> => {
    const root = getRepoRoot(workspaceId)
    if (!root) return []
    try {
      const git = simpleGit(root)
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

export async function startWorktreePollingForWorkspace(
  workspaceId: string,
  repoRoot: string,
  getWebContents: GetWebContents,
): Promise<void> {
  stopWorktreePollingForWorkspace(workspaceId)

  const active = getActiveWorktreeForWorkspace(workspaceId)
  let lastJson = ''
  const initial = await fetchWorktreeList(repoRoot, active)
  lastJson = JSON.stringify(initial)
  getWebContents()?.send(IpcChannels.WORKTREE_LIST_CHANGED, worktreeListPayload(workspaceId, initial))

  const pollTimer = setInterval(async () => {
    const a = getActiveWorktreeForWorkspace(workspaceId)
    const list = await fetchWorktreeList(repoRoot, a)
    const json = JSON.stringify(list)
    if (json !== lastJson) {
      lastJson = json
      getWebContents()?.send(IpcChannels.WORKTREE_LIST_CHANGED, worktreeListPayload(workspaceId, list))
    }
  }, 5000)

  worktreePollByWorkspaceId.set(workspaceId, { pollTimer, repoRoot, lastJson })
}

export function stopWorktreePollingForWorkspace(workspaceId: string): void {
  const entry = worktreePollByWorkspaceId.get(workspaceId)
  if (!entry) return
  clearInterval(entry.pollTimer)
  worktreePollByWorkspaceId.delete(workspaceId)
}

export function stopAllWorktreePolling(): void {
  for (const id of worktreePollByWorkspaceId.keys()) {
    stopWorktreePollingForWorkspace(id)
  }
}

export function clearWorktreeStateForWorkspace(workspaceId: string): void {
  activeWorktreeByWorkspaceId.delete(workspaceId)
  stopWorktreePollingForWorkspace(workspaceId)
}

/** @deprecated */
export async function startWorktreePolling(
  repoRoot: string,
  getWebContents: GetWebContents,
  _store: unknown,
  workspaceId: string,
): Promise<void> {
  return startWorktreePollingForWorkspace(workspaceId, repoRoot, getWebContents)
}

/** @deprecated */
export function stopWorktreePolling(): void {
  stopAllWorktreePolling()
}
