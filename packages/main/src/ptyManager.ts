import { ipcMain, type WebContents } from 'electron'
import { spawn, type IPty } from 'node-pty'
import { randomUUID } from 'crypto'
import * as os from 'os'
import { IpcChannels } from '@aide/shared'
import type Store from 'electron-store'
import type { AppSettings } from '@aide/shared'

const ptys = new Map<string, IPty>()

function detectShell(): string {
  if (process.platform === 'win32') return 'powershell.exe'
  return process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
}

export function registerPtyHandlers(
  getWebContents: () => WebContents | null,
  store: Store<AppSettings>,
): void {
  ipcMain.handle(IpcChannels.PTY_CREATE, (_event, opts?: { cwd?: string; shell?: string }) => {
    const id = randomUUID()
    const cwd = opts?.cwd || store.get('workspaceRoot') || os.homedir()
    const shell = opts?.shell || detectShell()

    const pty = spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: { ...process.env } as Record<string, string>,
    })

    ptys.set(id, pty)

    pty.onData((data) => {
      getWebContents()?.send(IpcChannels.PTY_DATA_OUT, id, data)
    })

    pty.onExit(({ exitCode }) => {
      getWebContents()?.send(IpcChannels.PTY_EXIT, id, exitCode)
      ptys.delete(id)
    })

    return { id }
  })

  ipcMain.on(IpcChannels.PTY_DATA_IN, (_event, id: string, data: string) => {
    ptys.get(id)?.write(data)
  })

  ipcMain.on(IpcChannels.PTY_RESIZE, (_event, id: string, cols: number, rows: number) => {
    ptys.get(id)?.resize(cols, rows)
  })

  ipcMain.on(IpcChannels.PTY_KILL, (_event, id: string) => {
    const pty = ptys.get(id)
    if (pty) {
      pty.kill()
      ptys.delete(id)
    }
  })
}

export function killAllPtys(): void {
  for (const pty of ptys.values()) {
    pty.kill()
  }
  ptys.clear()
}
