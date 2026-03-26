import type { DockviewApi } from 'dockview-react'
import { registerCommand } from './CommandRegistry'
import { showToast } from '../components/Toast'

/**
 * Register all remaining built-in commands that aren't component-scoped.
 * Call once after DockviewApi is available.
 */
export function registerDefaultCommands(dockviewApi: DockviewApi): void {
  // Cmd+\ — split editor vertically
  registerCommand(
    { id: 'editor.splitVertical', label: 'Split Editor Right', keybinding: 'Cmd+\\', category: 'Editor' },
    () => {
      const active = dockviewApi.activePanel
      if (!active) return
      const filePath = (active.params as Record<string, unknown>)?.filePath as string | undefined
      if (!filePath) return
      dockviewApi.addPanel({
        id: `${filePath}:split-${Date.now()}`,
        component: 'editorPane',
        tabComponent: 'editorTab',
        title: filePath.split('/').pop() ?? filePath,
        params: { filePath },
        position: { referencePanel: active, direction: 'right' },
      })
    },
  )

  // Cmd+Shift+\ — split editor horizontally
  registerCommand(
    { id: 'editor.splitHorizontal', label: 'Split Editor Down', keybinding: 'Cmd+Shift+\\', category: 'Editor' },
    () => {
      const active = dockviewApi.activePanel
      if (!active) return
      const filePath = (active.params as Record<string, unknown>)?.filePath as string | undefined
      if (!filePath) return
      dockviewApi.addPanel({
        id: `${filePath}:split-${Date.now()}`,
        component: 'editorPane',
        tabComponent: 'editorTab',
        title: filePath.split('/').pop() ?? filePath,
        params: { filePath },
        position: { referencePanel: active, direction: 'below' },
      })
    },
  )

  // Cmd+1 through Cmd+9 — workspace switching (placeholder)
  for (let n = 1; n <= 9; n++) {
    registerCommand(
      { id: `workspace.switchTo${n}`, label: `Switch to Workspace ${n}`, keybinding: `Cmd+${n}`, category: 'Workspace' },
      () => showToast(`Workspace switching is not yet available`),
    )
  }

  // Cmd+Shift+] / Cmd+Shift+[ — cycle workspace tabs (placeholder)
  registerCommand(
    { id: 'workspace.cycleTabNext', label: 'Next Tab', keybinding: 'Cmd+Shift+]', category: 'Workspace' },
    () => showToast('Tab cycling is not yet available'),
  )

  registerCommand(
    { id: 'workspace.cycleTabPrev', label: 'Previous Tab', keybinding: 'Cmd+Shift+[', category: 'Workspace' },
    () => showToast('Tab cycling is not yet available'),
  )

  // Cmd+T — symbol search (placeholder, awaiting LSP)
  registerCommand(
    { id: 'editor.symbolSearch', label: 'Go to Symbol', keybinding: 'Cmd+T', category: 'Editor' },
    () => showToast('Symbol search requires LSP (coming in Phase 3)'),
  )
}
