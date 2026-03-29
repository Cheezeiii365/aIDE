/**
 * @fileoverview Command-palette entry point for inline git diff in the active CodeMirror editor.
 *
 * Used by `editor.toggleInlineDiff` in `commands/domains/editor.ts`. The editor pane itself also toggles via
 * local keybinding; this path uses `getActiveEditor()` so it works without a custom DOM event.
 */

import { showToast } from '../../components/shared/Toast'
import { getActiveEditor } from './activeEditor'
import { toggleInlineDiff } from './editorInlineDiff'

/**
 * Runs `toggleInlineDiff` on whichever editor last reported focus to `activeEditor`.
 * Uses `getWorkspaceRoot()` from preload when resolving git baseline (same idea as `EditorPane`).
 */
export async function toggleInlineDiffInActiveEditor(): Promise<void> {
  const active = getActiveEditor()
  if (!active) {
    showToast('No active editor')
    return
  }
  const rootPath = await window.api.getWorkspaceRoot()
  const enabled = await toggleInlineDiff(active.view, rootPath, active.filePath)
  showToast(enabled ? 'Inline diff enabled' : 'Inline diff disabled')
}
