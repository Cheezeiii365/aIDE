import { useState } from 'react'

/**
 * TUI control panel for OpenCode sessions. Mostly diagnostic / power-user
 * — these are the same commands the OpenCode TUI exposes (open help,
 * show toast, execute command, etc.). Useful when running an external
 * opencode TUI alongside aIDE.
 */
export function TuiControlPanel({ sessionId }: { sessionId: string | null }) {
  const [open, setOpen] = useState(false)
  const [appendText, setAppendText] = useState('')
  const [execCmd, setExecCmd] = useState('')

  if (!sessionId) return null

  const call = async (fn: () => Promise<{ error?: string }>) => {
    const result = await fn()
    if (result.error) console.warn('TUI op failed', result.error)
  }

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      style={{
        margin: '6px 0',
        padding: '6px 8px',
        background: 'var(--color-surface-2, rgba(255,255,255,0.04))',
        borderRadius: 4,
        fontSize: 11,
      }}
    >
      <summary style={{ cursor: 'pointer', userSelect: 'none' }}>TUI control</summary>
      {open && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <button onClick={() => void call(() => window.api.cliAgentTuiOpenHelp(sessionId))}>
              Help
            </button>
            <button onClick={() => void call(() => window.api.cliAgentTuiOpenSessions(sessionId))}>
              Sessions
            </button>
            <button onClick={() => void call(() => window.api.cliAgentTuiOpenThemes(sessionId))}>
              Themes
            </button>
            <button onClick={() => void call(() => window.api.cliAgentTuiOpenModels(sessionId))}>
              Models
            </button>
            <button onClick={() => void call(() => window.api.cliAgentTuiSubmitPrompt(sessionId))}>
              Submit
            </button>
            <button onClick={() => void call(() => window.api.cliAgentTuiClearPrompt(sessionId))}>
              Clear
            </button>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              value={appendText}
              onChange={(e) => setAppendText(e.target.value)}
              placeholder="Text to append…"
              style={{ flex: 1, fontSize: 11 }}
            />
            <button
              onClick={() => {
                void call(() => window.api.cliAgentTuiAppendPrompt(sessionId, appendText))
                setAppendText('')
              }}
            >
              Append
            </button>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              value={execCmd}
              onChange={(e) => setExecCmd(e.target.value)}
              placeholder="TUI command…"
              style={{ flex: 1, fontSize: 11 }}
            />
            <button
              onClick={() => {
                void call(() => window.api.cliAgentTuiExecuteCommand(sessionId, execCmd))
                setExecCmd('')
              }}
            >
              Execute
            </button>
          </div>
        </div>
      )}
    </details>
  )
}
