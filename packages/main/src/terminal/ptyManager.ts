import { ipcMain, type WebContents } from 'electron'
import { spawn, type IPty } from 'node-pty'
import { randomUUID } from 'crypto'
import * as os from 'os'
import * as fs from 'fs'
import { IpcChannels } from '@aide/shared'
import type Store from 'electron-store'
import type { AppSettings } from '@aide/shared'

interface PtySession {
  id: string
  workspaceId: string | null
  pty: IPty
  cwd: string
  shell: string
  title?: string
  scrollback: string
}

const ptys = new Map<string, PtySession>()
const MAX_SCROLLBACK_CHARS = 200_000

/**
 * Appends new PTY output to the stored scrollback while enforcing the maximum scrollback length.
 *
 * @param current - Existing stored scrollback
 * @param chunk - New output to append
 * @returns The updated scrollback containing the last up to MAX_SCROLLBACK_CHARS characters of the concatenated input
 */
function appendScrollback(current: string, chunk: string): string {
  const next = current + chunk
  if (next.length <= MAX_SCROLLBACK_CHARS) return next
  return next.slice(next.length - MAX_SCROLLBACK_CHARS)
}

/**
 * Selects a sensible default shell for the current platform.
 *
 * @returns `powershell.exe` on Windows; otherwise the value of `process.env.SHELL` if set; if not set, `/bin/zsh` on macOS, and `/bin/bash` on other platforms.
 */
function detectShell(): string {
  if (process.platform === 'win32') return 'powershell.exe'
  return process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
}

/**
 * Register IPC handlers for creating, controlling, and terminating pseudo-terminal (PTY) sessions and for forwarding PTY events to the renderer.
 *
 * @param getWebContents - Function that returns the current renderer WebContents or `null`; used to send PTY events back to the renderer.
 * @param store - Application settings store used to resolve default workspace/root paths and related configuration.
 */
export function registerPtyHandlers(
  getWebContents: () => WebContents | null,
  store: Store<AppSettings>,
): void {
  ipcMain.handle(IpcChannels.PTY_CREATE, (_event, opts?: { id?: string; workspaceId?: string; cwd?: string; shell?: string; title?: string }) => {
    const id = opts?.id || randomUUID()
    const existing = ptys.get(id)
    if (existing) {
      return { id: existing.id, scrollback: existing.scrollback }
    }

    const preferredCwd = opts?.cwd || store.get('workspaceRoot') || os.homedir()
    const cwd = fs.existsSync(preferredCwd) ? preferredCwd : os.homedir()
    const shell = opts?.shell || detectShell()

    const args = process.platform === 'win32' ? [] : ['-l']
    const pty = spawn(shell, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: { ...process.env } as Record<string, string>,
    })

    const session: PtySession = {
      id,
      workspaceId: opts?.workspaceId || null,
      pty,
      cwd,
      shell,
      title: opts?.title,
      scrollback: '',
    }

    ptys.set(id, session)

    pty.onData((data) => {
      session.scrollback = appendScrollback(session.scrollback, data)
      getWebContents()?.send(IpcChannels.PTY_DATA_OUT, id, data)
    })

    pty.onExit(({ exitCode }) => {
      getWebContents()?.send(IpcChannels.PTY_EXIT, id, exitCode)
      ptys.delete(id)
    })

    return { id, scrollback: session.scrollback }
  })

  ipcMain.on(IpcChannels.PTY_DATA_IN, (_event, id: string, data: string) => {
    ptys.get(id)?.pty.write(data)
  })

  ipcMain.on(IpcChannels.PTY_RESIZE, (_event, id: string, cols: number, rows: number) => {
    ptys.get(id)?.pty.resize(cols, rows)
  })

  ipcMain.on(IpcChannels.PTY_KILL, (_event, id: string) => {
    const session = ptys.get(id)
    if (session) {
      session.pty.kill()
      ptys.delete(id)
    }
  })

  ipcMain.on(IpcChannels.PTY_KILL_WORKSPACE, (_event, workspaceId: string) => {
    for (const [id, session] of ptys) {
      if (session.workspaceId === workspaceId) {
        session.pty.kill()
        ptys.delete(id)
      }
    }
  })
}

/**
 * Terminate all active PTY sessions and clear the internal session store.
 *
 * Kills each session's underlying pseudo-terminal process and removes all entries from the PTY session map.
 */
export function killAllPtys(): void {
  for (const session of ptys.values()) {
    session.pty.kill()
  }
  ptys.clear()
}
