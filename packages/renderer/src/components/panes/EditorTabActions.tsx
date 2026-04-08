import type { IDockviewHeaderActionsProps } from 'dockview-react'
import { executeCommand } from '../../commands/CommandRegistry'

/**
 * Right-side actions rendered in every Dockview group header.
 * Visual stubs — wire to real commands as they land.
 */
export function EditorTabActions(_props: IDockviewHeaderActionsProps) {
  return (
    <div className="editor-tab-actions">
      <button
        type="button"
        className="editor-tab-actions__btn"
        title="New file"
        aria-label="New file"
        // TODO: wire to new-file command
      >
        <svg width="14" height="14" viewBox="0 0 14 14">
          <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        className="editor-tab-actions__btn"
        title="Plugins"
        aria-label="Plugins"
        // TODO: wire to plugins panel
      >
        <svg width="14" height="14" viewBox="0 0 14 14">
          <path
            d="M5 1.5h2a1 1 0 011 1V4h1.5a1 1 0 011 1v1.5H12a1 1 0 011 1v2a1 1 0 01-1 1h-1.5V12a1 1 0 01-1 1H8v-1.5a1.25 1.25 0 10-2 0V13H4.5a1 1 0 01-1-1v-1.5H2a1 1 0 01-1-1V8.5h1.5a1.25 1.25 0 100-2.5H1V5a1 1 0 011-1h2V2.5a1 1 0 011-1z"
            stroke="currentColor"
            strokeWidth="1.1"
            fill="none"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="editor-tab-actions__btn"
        title="Split editor"
        aria-label="Split editor"
        onClick={() => executeCommand('editor.splitVertical')}
      >
        <svg width="14" height="14" viewBox="0 0 14 14">
          <rect x="1.5" y="2" width="11" height="10" rx="1" stroke="currentColor" strokeWidth="1.1" fill="none" />
          <path d="M7 2v10" stroke="currentColor" strokeWidth="1.1" />
        </svg>
      </button>
    </div>
  )
}
