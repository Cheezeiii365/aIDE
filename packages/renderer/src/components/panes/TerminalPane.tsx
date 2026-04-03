import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { IDockviewPanelProps } from 'dockview-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { WorktreeInfo } from '@aide/shared'
import { getXtermTheme } from '../../lib/terminal/terminalTheme'
import { type TerminalPanelParams } from '../../lib/terminal/terminalState'
import { getAppActions } from '../../lib/appActions'
import { getPanelZoomFactor } from '../../lib/panelZoom'
import { useTheme } from '../../hooks/useTheme'
import '@xterm/xterm/css/xterm.css'
import '../../styles/terminal-pane.css'

interface ContextMenuState {
  x: number
  y: number
}

const TERMINAL_BASE_FONT_SIZE = 13

/**
 * Render a terminal pane hosting an xterm.js terminal connected to a backend PTY and offering an in-terminal context menu for switching worktrees.
 *
 * @param params - Optional panel parameters.
 * @param params.worktreePath - If provided, used as the PTY's initial working directory.
 * @returns The React element for the terminal pane.
 */
export function TerminalPane({ api, params }: IDockviewPanelProps<TerminalPanelParams>) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const ptyIdRef = useRef<string | null>(null)
  const terminalIdRef = useRef<string>(params?.terminalId || globalThis.crypto?.randomUUID?.() || `terminal-${Date.now()}`)
  const cleanupDataRef = useRef<(() => void) | null>(null)
  const cleanupExitRef = useRef<(() => void) | null>(null)
  const inputDisposableRef = useRef<{ dispose(): void } | null>(null)
  const { theme } = useTheme()
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([])
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (params?.terminalId) return
    api.updateParameters({
      ...params,
      terminalId: terminalIdRef.current,
      title: params?.title ?? 'Terminal',
    })
  }, [api, params])

  // Create terminal on mount
  useEffect(() => {
    if (!hostRef.current) return

    let destroyed = false

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "'SF Mono', Menlo, Monaco, 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.3,
      theme: getXtermTheme(),
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        getAppActions()?.openUrl(uri)
      }),
    )

    term.open(hostRef.current)
    termRef.current = term
    fitRef.current = fitAddon

    requestAnimationFrame(() => {
      if (!destroyed) fitAddon.fit()
    })

    /**
     * Initializes a PTY for the terminal, attaches IO handlers, and synchronizes terminal state.
     *
     * If a taskPtyId is provided, attaches to the existing task-owned PTY instead of creating a new one.
     * Otherwise creates a PTY using the component parameters (including a stable terminal id and cwd),
     * stores the returned PTY id, writes any returned scrollback into the terminal, sends an initial
     * resize to match the terminal's columns and rows, forwards terminal input to the PTY, and
     * subscribes to PTY data and exit events.
     */
    async function init() {
      // Task-owned PTY: attach to existing stream without creating a new PTY
      if (params?.taskPtyId) {
        const id = params.taskPtyId
        ptyIdRef.current = id

        inputDisposableRef.current = term.onData((data) => {
          window.api.ptyWrite(id, data)
        })

        cleanupDataRef.current = window.api.onPtyData((payload) => {
          if (payload.ptyId === id && (!params?.workspaceId || payload.workspaceId === params.workspaceId)) {
            term.write(payload.data)
          }
        })

        cleanupExitRef.current = window.api.onPtyExit((payload) => {
          if (payload.ptyId === id && (!params?.workspaceId || payload.workspaceId === params.workspaceId)) {
            term.write(`\r\n[Process exited with code ${payload.exitCode}]\r\n`)
          }
        })
        return
      }

      const cwd = params?.worktreePath || undefined
      const { id, scrollback } = await window.api.ptyCreate({
        id: terminalIdRef.current,
        workspaceId: params?.workspaceId,
        cwd,
        shell: params?.shell,
        title: params?.title ?? 'Terminal',
      })
      if (destroyed) return

      ptyIdRef.current = id
      if (scrollback) {
        term.write(scrollback)
      }
      window.api.ptyResize(id, term.cols, term.rows)

      inputDisposableRef.current = term.onData((data) => {
        window.api.ptyWrite(id, data)
      })

      cleanupDataRef.current = window.api.onPtyData((payload) => {
        if (payload.ptyId === id && (!params?.workspaceId || payload.workspaceId === params.workspaceId)) {
          term.write(payload.data)
        }
      })

      cleanupExitRef.current = window.api.onPtyExit((payload) => {
        if (payload.ptyId === id && (!params?.workspaceId || payload.workspaceId === params.workspaceId)) {
          term.write(`\r\n[Process exited with code ${payload.exitCode}]\r\n`)
        }
      })
    }

    init()

    // ResizeObserver for fit + pty resize
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const observer = new ResizeObserver(() => {
      fitAddon.fit()
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        const id = ptyIdRef.current
        if (id) window.api.ptyResize(id, term.cols, term.rows)
      }, 50)
    })
    if (hostRef.current) observer.observe(hostRef.current)

    return () => {
      destroyed = true
      observer.disconnect()
      if (resizeTimer) clearTimeout(resizeTimer)
      inputDisposableRef.current?.dispose()
      cleanupDataRef.current?.()
      cleanupExitRef.current?.()
      inputDisposableRef.current = null
      cleanupDataRef.current = null
      cleanupExitRef.current = null
      term.dispose()
      termRef.current = null
      fitRef.current = null
      ptyIdRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Rebind PTY listeners when taskPtyId changes (reused task terminal panels)
  useEffect(() => {
    const term = termRef.current
    const newPtyId = params?.taskPtyId
    if (!term || !newPtyId) return
    // Skip if already bound to this PTY (initial mount handled it)
    if (ptyIdRef.current === newPtyId) return

    // Tear down previous PTY listeners
    inputDisposableRef.current?.dispose()
    cleanupDataRef.current?.()
    cleanupExitRef.current?.()

    ptyIdRef.current = newPtyId

    // Clear terminal for the new task run
    term.clear()
    term.write('\x1b[2J\x1b[H') // full clear + cursor home

    inputDisposableRef.current = term.onData((data) => {
      window.api.ptyWrite(newPtyId, data)
    })

    cleanupDataRef.current = window.api.onPtyData((payload) => {
      if (
        payload.ptyId === newPtyId
        && (!params?.workspaceId || payload.workspaceId === params.workspaceId)
      ) {
        term.write(payload.data)
      }
    })

    cleanupExitRef.current = window.api.onPtyExit((payload) => {
      if (
        payload.ptyId === newPtyId
        && (!params?.workspaceId || payload.workspaceId === params.workspaceId)
      ) {
        term.write(`\r\n[Process exited with code ${payload.exitCode}]\r\n`)
      }
    })

    // Sync terminal size with the new PTY
    window.api.ptyResize(newPtyId, term.cols, term.rows)
  }, [params?.taskPtyId])

  // Focus terminal when panel becomes active
  useEffect(() => {
    const disposable = api.onDidActiveChange(({ isActive }) => {
      if (isActive) termRef.current?.focus()
    })
    return () => disposable.dispose()
  }, [api])

  // Update xterm theme when app theme changes
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = getXtermTheme()
    }
  }, [theme])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontSize = Math.round(TERMINAL_BASE_FONT_SIZE * getPanelZoomFactor(params))
    fitRef.current?.fit()
    const ptyId = ptyIdRef.current
    if (ptyId) {
      window.requestAnimationFrame(() => {
        if (ptyIdRef.current) window.api.ptyResize(ptyId, term.cols, term.rows)
      })
    }
  }, [params])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const wid = params?.workspaceId
    if (wid) {
      window.api.listWorktrees(wid).then(setWorktrees)
    } else {
      setWorktrees([])
    }
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [params?.workspaceId])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  // Adjust context menu position
  useEffect(() => {
    const el = menuRef.current
    if (!el || !contextMenu) return
    const rect = el.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      el.style.left = `${window.innerWidth - rect.width - 4}px`
    }
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${window.innerHeight - rect.height - 4}px`
    }
  }, [contextMenu])

  // Close context menu on Escape
  useEffect(() => {
    if (!contextMenu) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [contextMenu, closeContextMenu])

  const switchToWorktree = useCallback((path: string) => {
    const ptyId = ptyIdRef.current
    if (ptyId) {
      window.api.ptyWrite(ptyId, `cd ${path}\n`)
    }
    api.updateParameters({
      ...params,
      terminalId: terminalIdRef.current,
      worktreePath: path,
      title: params?.title ?? 'Terminal',
    })
    closeContextMenu()
  }, [api, closeContextMenu, params])

  return (
    <>
      <div ref={hostRef} className="terminal-pane" onContextMenu={handleContextMenu} />
      {contextMenu && worktrees.length > 1 && createPortal(
        <div className="context-menu-overlay" onMouseDown={closeContextMenu}>
          <div
            ref={menuRef}
            className="context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="context-menu__item" style={{ cursor: 'default', opacity: 0.6, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Switch to worktree
            </div>
            {worktrees.map((wt) => (
              <button
                key={wt.path}
                className="context-menu__item"
                onClick={() => switchToWorktree(wt.path)}
              >
                {wt.branch}{wt.isMain ? ' (main)' : ''}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
