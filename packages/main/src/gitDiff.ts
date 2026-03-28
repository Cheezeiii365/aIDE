import path from 'node:path'
import { ipcMain } from 'electron'
import simpleGit from 'simple-git'
import { IpcChannels } from '@aide/shared'

let currentRoot: string | null = null

/**
 * Set the workspace root used for git diff operations.
 */
export function setDiffRoot(rootPath: string | null): void {
  currentRoot = rootPath
}

/**
 * Get the original (HEAD) content of a file from git.
 * Returns the file content as it exists in the HEAD commit,
 * or null if the file is untracked / not in HEAD.
 */
async function getOriginalContent(rootPath: string, absolutePath: string): Promise<string | null> {
  try {
    const git = simpleGit(rootPath)
    const isRepo = await git.checkIsRepo()
    if (!isRepo) return null

    const relativePath = path.relative(rootPath, absolutePath)
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      console.warn(`[gitDiff] Path outside repo: ${absolutePath} (root: ${rootPath})`)
      return null
    }

    const content = await git.show([`HEAD:${relativePath}`])
    return content
  } catch {
    // File doesn't exist in HEAD (new/untracked file) or other error
    return null
  }
}

/**
 * Register IPC handlers for git diff operations.
 */
export function registerGitDiffHandlers(): void {
  ipcMain.handle(IpcChannels.GIT_DIFF_ORIGINAL, async (_event, filePath: string) => {
    if (!currentRoot) return { content: null }
    const content = await getOriginalContent(currentRoot, filePath)
    return { content }
  })
}
