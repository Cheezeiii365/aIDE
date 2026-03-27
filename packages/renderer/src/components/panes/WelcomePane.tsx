import type { IDockviewPanelProps } from 'dockview-react'

/**
 * Render the welcome pane UI with title, action buttons, and keyboard shortcut hints.
 *
 * The pane applies `--panel-zoom` from `params?.zoomFactor` to scale its contents.
 * Clicking the primary and secondary action buttons dispatches `aide:workspace-open-folder`
 * and `aide:workspace-new-blank` CustomEvents on `window`, respectively.
 *
 * @param params - Panel parameters; `params.zoomFactor` (optional) sets the CSS `--panel-zoom` value
 * @returns A React element representing the welcome pane
 */
export function WelcomePane({ params }: IDockviewPanelProps<{ zoomFactor?: number }>) {
  const isMac = navigator.platform.includes('Mac')
  const mod = isMac ? '\u2318' : 'Ctrl'

  return (
    <div className="welcome-pane" style={{ ['--panel-zoom' as string]: String(params?.zoomFactor ?? 1) }}>
      <div className="welcome-pane__content">
        <h1 className="welcome-pane__title">aIDE</h1>
        <p className="welcome-pane__subtitle">Multi-agent IDE</p>

        <div className="welcome-pane__actions">
          <button
            className="welcome-pane__action welcome-pane__action--primary"
            onClick={() => window.dispatchEvent(new CustomEvent('aide:workspace-open-folder'))}
          >
            <span className="welcome-pane__action-label">Open Folder</span>
            <kbd className="welcome-pane__kbd">{mod}+O</kbd>
          </button>

          <button
            className="welcome-pane__action"
            onClick={() => window.dispatchEvent(new CustomEvent('aide:workspace-new-blank'))}
          >
            <span className="welcome-pane__action-label">New Workspace</span>
            <kbd className="welcome-pane__kbd">{mod}+Shift+N</kbd>
          </button>
        </div>

        <div className="welcome-pane__hints">
          <div className="welcome-pane__hint">
            <kbd className="welcome-pane__kbd">{mod}+Shift+P</kbd>
            <span>Command Palette</span>
          </div>
          <div className="welcome-pane__hint">
            <kbd className="welcome-pane__kbd">{mod}+P</kbd>
            <span>Quick Open File</span>
          </div>
          <div className="welcome-pane__hint">
            <kbd className="welcome-pane__kbd">{mod}+Shift+T</kbd>
            <span>New Terminal</span>
          </div>
        </div>
      </div>
    </div>
  )
}
