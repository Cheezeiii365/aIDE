import type { EditorView } from '@codemirror/view'

interface ActiveEditorState {
  view: EditorView
  filePath: string
}

let activeEditor: ActiveEditorState | null = null

export function setActiveEditor(view: EditorView, filePath: string): void {
  activeEditor = { view, filePath }
}

export function clearActiveEditor(view: EditorView): void {
  if (activeEditor?.view === view) {
    activeEditor = null
  }
}

export function getActiveEditor(): ActiveEditorState | null {
  return activeEditor
}
