import { ipcMain } from 'electron'
import simpleGit from 'simple-git'
import { IpcChannels } from '@aide/shared'
import type { GitBranchChangedPayload, GitFileStatus, GitStatusChangedPayload, GitStatusResult } from '@aide/shared'

type GetWebContents = () => Electron.WebContents | null

interface GitPollEntry {
  pollTimer: ReturnType<typeof setInterval>
  rootPath: string
  workspaceId: string
}

const pollsByWorkspace = new Map<string, GitPollEntry>()

/**
 * Obtains Git status for the repository at the given root path.
 */
export async function fetchGitStatus(rootPath: string): Promise<GitStatusResult | null> {
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
      // non-fatal
    }

    return { files, branch: status.current ?? 'HEAD', ignoredPaths }
  } catch {
    return null
  }
}

/**
 * Register GIT_STATUS handler: requires `workspaceId` to resolve the polling root for that runtime.
 */
export function registerGitStatusHandlers(): void {
  ipcMain.handle(IpcChannels.GIT_STATUS, async (_event, workspaceId: string) => {
    const entry = pollsByWorkspace.get(workspaceId)
    if (!entry?.rootPath) return null
    return fetchGitStatus(entry.rootPath)
  })
}

/**
 * Begin Git polling for one workspace. Multiple workspaces poll concurrently.
 */
export async function startGitPollingForWorkspace(
  workspaceId: string,
  rootPath: string,
  getWebContents: GetWebContents,
): Promise<void> {
  stopGitPollingForWorkspace(workspaceId)

  let lastJson = ''
  let lastBranch = ''
  let lastIgnoredJson = ''

  const initial = await fetchGitStatus(rootPath)
  if (initial) {
    lastJson = JSON.stringify(initial.files)
    lastBranch = initial.branch
    lastIgnoredJson = JSON.stringify(initial.ignoredPaths)
    const wc = getWebContents()
    if (wc) {
      const statusPayload: GitStatusChangedPayload = { workspaceId, status: initial }
      wc.send(IpcChannels.GIT_STATUS_CHANGED, statusPayload)
      const branchPayload: GitBranchChangedPayload = { workspaceId, branch: initial.branch }
      wc.send(IpcChannels.GIT_BRANCH_CHANGED, branchPayload)
    }
  }

  const pollTimer = setInterval(async () => {
    const result = await fetchGitStatus(rootPath)
    if (!result) return

    const wc = getWebContents()
    if (!wc) return

    const json = JSON.stringify(result.files)
    const ignoredJson = JSON.stringify(result.ignoredPaths)
    if (json !== lastJson || ignoredJson !== lastIgnoredJson) {
      lastJson = json
      lastIgnoredJson = ignoredJson
      const statusPayload: GitStatusChangedPayload = { workspaceId, status: result }
      wc.send(IpcChannels.GIT_STATUS_CHANGED, statusPayload)
    }

    if (result.branch !== lastBranch) {
      lastBranch = result.branch
      const branchPayload: GitBranchChangedPayload = { workspaceId, branch: result.branch }
      wc.send(IpcChannels.GIT_BRANCH_CHANGED, branchPayload)
    }
  }, 3000)

  pollsByWorkspace.set(workspaceId, { pollTimer, rootPath, workspaceId })
}

export function stopGitPollingForWorkspace(workspaceId: string): void {
  const entry = pollsByWorkspace.get(workspaceId)
  if (!entry) return
  clearInterval(entry.pollTimer)
  pollsByWorkspace.delete(workspaceId)
}

export function stopAllGitPolling(): void {
  for (const id of [...pollsByWorkspace.keys()]) {
    stopGitPollingForWorkspace(id)
  }
}

/** @deprecated Use startGitPollingForWorkspace */
export async function startGitPolling(
  rootPath: string,
  getWebContents: GetWebContents,
  workspaceId: string,
): Promise<void> {
  return startGitPollingForWorkspace(workspaceId, rootPath, getWebContents)
}

/** @deprecated Use stopAllGitPolling or stopGitPollingForWorkspace */
export function stopGitPolling(): void {
  stopAllGitPolling()
}
