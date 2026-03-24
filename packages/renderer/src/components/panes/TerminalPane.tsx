import { useEffect, useRef } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { getXtermTheme } from '../../lib/terminalTheme'
import { getAppActions } from '../../lib/appActions'
import { useTheme } from '../../hooks/useTheme'
import '@xterm/xterm/css/xterm.css'
import '../../styles/terminal-pane.css'

export function TerminalPane({ api }: IDockviewPanelProps<Record<string, never>>) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const ptyIdRef = useRef<string | null>(null)
  const { theme } = useTheme()

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
      const { id } = await window.api.ptyCreate()
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

  return <div ref={hostRef} className="terminal-pane" />
}
