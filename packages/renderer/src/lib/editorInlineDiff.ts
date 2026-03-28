import { Compartment } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { unifiedMergeView, acceptChunk, rejectChunk, getOriginalDoc } from '@codemirror/merge'

/** Who produced the diff — determines whether accept/decline controls appear. */
export type DiffSource = 'git' | 'agent'

export interface DiffOptions {
  original: string
  source: DiffSource
}

/** Compartment used to toggle inline diff on/off. */
export const diffCompartment = new Compartment()

/**
 * Create the unified merge view extension configured for aIDE.
 * Shows deleted lines inline, gutter indicators, and optionally accept/reject controls.
 * Controls only appear for agent-sourced diffs.
 */
function createMergeExtension(options: DiffOptions): Extension {
  return unifiedMergeView({
    original: options.original,
    highlightChanges: true,
    gutter: true,
    syntaxHighlightDeletions: true,
    mergeControls: options.source === 'agent',
    allowInlineDiffs: true,
  })
}

/**
 * Enable inline diff mode by comparing against the given original content.
 * The current editor content is treated as the "new" version.
 */
export function enableInlineDiff(view: EditorView, options: DiffOptions): void {
  view.dispatch({
    effects: diffCompartment.reconfigure(createMergeExtension(options)),
  })
}

/**
 * Disable inline diff mode and return to normal editing.
 */
export function disableInlineDiff(view: EditorView): void {
  view.dispatch({
    effects: diffCompartment.reconfigure([]),
  })
}

/**
 * Check if inline diff is currently active.
 */
export function isInlineDiffActive(view: EditorView): boolean {
  try {
    getOriginalDoc(view.state)
    return true
  } catch {
    return false
  }
}

/**
 * Toggle inline diff on/off. When enabling, fetches the original
 * content from git via the preload API.
 * Returns true if diff was enabled, false if disabled.
 */
export async function toggleInlineDiff(
  view: EditorView,
  filePath: string,
  source: DiffSource = 'git',
): Promise<boolean> {
  if (isInlineDiffActive(view)) {
    disableInlineDiff(view)
    return false
  }

  const result = await window.api.getGitFileOriginal(filePath)
  const original = result.content ?? ''
  enableInlineDiff(view, { original, source })
  return true
}

/**
 * Accept the change chunk at the cursor position.
 */
export function acceptCurrentChunk(view: EditorView): boolean {
  return acceptChunk(view)
}

/**
 * Reject the change chunk at the cursor position (revert to original).
 */
export function rejectCurrentChunk(view: EditorView): boolean {
  return rejectChunk(view)
}
