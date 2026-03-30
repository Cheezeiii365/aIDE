/**
 * @fileoverview Editor-focused commands: split panes, line comments, inline diff, symbol placeholder.
 *
 * Splits clone the active editor panel’s `filePath` / `workspaceRoot` params into a new Dockview panel.
 * Comment and diff commands use the global active editor tracker (`lib/editor/activeEditor`).
 */

import type { DockviewApi } from 'dockview-react'
import { showToast } from '../../components/shared/Toast'
import {
  commentLineInActiveEditor,
  toggleLineCommentInActiveEditor,
  uncommentLineInActiveEditor,
} from '../../lib/editor/editorComments'
import { getActiveEditor } from '../../lib/editor/activeEditor'
import { toggleInlineDiffInActiveEditor } from '../../lib/editor/activeEditorInlineDiff'
import type { GetCommandContext } from '../context'
import type { CommandSpec } from './types'

/** Opens a second editor tab from the currently active editor’s file, split right or downward. */
function splitEditor(api: DockviewApi, direction: 'right' | 'below'): void {
  const active = api.activePanel
  if (!active) return
  const filePath = (active.params as Record<string, unknown>)?.filePath as string | undefined
  const workspaceRoot = (active.params as Record<string, unknown>)?.workspaceRoot as string | null | undefined
  if (!filePath) return
  api.addPanel({
    id: `${filePath}:split-${Date.now()}`,
    component: 'editorPane',
    tabComponent: 'editorTab',
    title: filePath.split('/').pop() ?? filePath,
    params: { filePath, workspaceRoot },
    position: { referencePanel: active, direction },
  })
}

/**
 * @returns Editor command specs (`editor.*` ids).
 */
export function collectEditorCommands(getCtx: GetCommandContext): CommandSpec[] {
  return [
    {
      def: { id: 'editor.splitVertical', label: 'Split Editor Right', category: 'Editor' },
      handler: () => {
        const api = getCtx().getDockviewApi()
        if (!api) return
        splitEditor(api, 'right')
      },
    },
    {
      def: { id: 'editor.splitHorizontal', label: 'Split Editor Down', category: 'Editor' },
      handler: () => {
        const api = getCtx().getDockviewApi()
        if (!api) return
        splitEditor(api, 'below')
      },
    },
    {
      def: { id: 'editor.symbolSearch', label: 'Go to Symbol', category: 'Editor' },
      handler: () => showToast('Symbol search requires LSP (coming in Phase 3)'),
    },
    {
      def: { id: 'editor.toggleInlineDiff', label: 'Toggle Inline Diff', category: 'Editor' },
      handler: () => void toggleInlineDiffInActiveEditor(),
    },
    {
      def: { id: 'editor.toggleComment', label: 'Toggle Line Comment', category: 'Editor' },
      handler: () => {
        const result = toggleLineCommentInActiveEditor()
        if (result === 'no-editor') showToast('No active editor')
        else if (result === 'unsupported') showToast('Line comments are not available for this file type')
      },
    },
    {
      def: { id: 'editor.commentLine', label: 'Comment Line', category: 'Editor' },
      handler: () => {
        const result = commentLineInActiveEditor()
        if (result === 'no-editor') showToast('No active editor')
        else if (result === 'unsupported') showToast('Line comments are not available for this file type')
      },
    },
    {
      def: { id: 'editor.uncommentLine', label: 'Uncomment Line', category: 'Editor' },
      handler: () => {
        const result = uncommentLineInActiveEditor()
        if (result === 'no-editor') showToast('No active editor')
        else if (result === 'unsupported') showToast('Line comments are not available for this file type')
      },
    },
    {
      def: { id: 'editor.openFileInVSCode', label: 'Open Active File in VS Code', category: 'Editor' },
      handler: async () => {
        const root = getCtx().getWorkspaceRoot()
        if (!root) {
          showToast('No workspace root available')
          return
        }

        const active = getActiveEditor()
        if (!active) {
          showToast('No active editor')
          return
        }

        const { view, filePath } = active
        const pos = view.state.selection.main.head
        const lineInfo = view.state.doc.lineAt(pos)
        const line = lineInfo.number
        const col = pos - lineInfo.from + 1

        const result = await window.api.openInVSCode(root, [{ path: filePath, line, col }])
        if ('error' in result) {
          showToast(result.error)
        }
      },
    }
  ]
}
