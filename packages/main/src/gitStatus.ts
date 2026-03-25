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
    // Staged but also modified in working tree — show as modified
    for (const f of status.conflicted) {
      files[`${rootPath}/${f}`] = 'M'
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

export function registerGitStatusHandlers(getWebContents: GetWebContents): void {
  ipcMain.handle(IpcChannels.GIT_STATUS, async () => {
    if (!currentRoot) return null
    return fetchGitStatus(currentRoot)
  })
}

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
