import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { IDockviewPanelProps } from 'dockview-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { WorktreeInfo } from '@aide/shared'
import { getXtermTheme } from '../../lib/terminalTheme'
import { getAppActions } from '../../lib/appActions'
import { useTheme } from '../../hooks/useTheme'
import '@xterm/xterm/css/xterm.css'
import '../../styles/terminal-pane.css'

interface TerminalParams {
  worktreePath?: string
}

interface ContextMenuState {
  x: number
  y: number
}

export function TerminalPane({ api, params }: IDockviewPanelProps<TerminalParams>) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const ptyIdRef = useRef<string | null>(null)
  const { theme } = useTheme()
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([])
  const menuRef = useRef<HTMLDivElement>(null)

  // Create terminal on mount
  useEffect(() => {
    if (!hostRef.current) return

    let destroyed = false
    let cleanupData: (() => void) | null = null
    let cleanupExit: (() => void) | null = null

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

    async function init() {
      const cwd = params?.worktreePath || undefined
      const { id } = await window.api.ptyCreate(cwd ? { cwd } : undefined)
      if (destroyed) {
        window.api.ptyKill(id)
        return
      }

      ptyIdRef.current = id
      window.api.ptyResize(id, term.cols, term.rows)

      term.onData((data) => {
        window.api.ptyWrite(id, data)
      })

      cleanupData = window.api.onPtyData((incomingId, data) => {
        if (incomingId === id) term.write(data)
      })

      cleanupExit = window.api.onPtyExit((incomingId, exitCode) => {
        if (incomingId === id) {
          term.write(`\r\n[Process exited with code ${exitCode}]\r\n`)
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
      cleanupData?.()
      cleanupExit?.()
      if (ptyIdRef.current) window.api.ptyKill(ptyIdRef.current)
      term.dispose()
      termRef.current = null
      fitRef.current = null
      ptyIdRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    // Load fresh worktree list for the context menu
    window.api.listWorktrees().then(setWorktrees)
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

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
    closeContextMenu()
  }, [closeContextMenu])

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
