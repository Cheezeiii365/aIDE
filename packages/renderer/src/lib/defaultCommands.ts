import type { DockviewApi } from 'dockview-react'
import { registerCommand } from './CommandRegistry'
import { showToast } from '../components/Toast'

/**
 * Register all remaining built-in commands that aren't component-scoped.
 * Call once after DockviewApi is available.
 */
export function registerDefaultCommands(dockviewApi: DockviewApi): void {
  registerCommand(
    { id: 'editor.splitVertical', label: 'Split Editor Right', category: 'Editor' },
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

  registerCommand(
    { id: 'editor.splitHorizontal', label: 'Split Editor Down', category: 'Editor' },
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

  for (let n = 1; n <= 9; n++) {
    registerCommand(
      { id: `workspace.switchTo${n}`, label: `Switch to Workspace ${n}`, category: 'Workspace' },
      () => window.dispatchEvent(new CustomEvent('aide:workspace-switch', { detail: { index: n - 1 } })),
    )
  }

  registerCommand(
    { id: 'workspace.close', label: 'Close Workspace', category: 'Workspace' },
    () => window.dispatchEvent(new CustomEvent('aide:workspace-close')),
  )

  registerCommand(
    { id: 'workspace.new', label: 'New Workspace', category: 'Workspace' },
    () => window.dispatchEvent(new CustomEvent('aide:workspace-new-blank')),
  )

  registerCommand(
    { id: 'workspace.openFolder', label: 'Open Folder...', category: 'Workspace' },
    () => window.dispatchEvent(new CustomEvent('aide:workspace-open-folder')),
  )

  registerCommand(
    { id: 'workspace.cycleTabNext', label: 'Next Workspace', category: 'Workspace' },
    () => window.dispatchEvent(new CustomEvent('aide:workspace-cycle', { detail: { direction: 1 } })),
  )

  registerCommand(
    { id: 'workspace.cycleTabPrev', label: 'Previous Workspace', category: 'Workspace' },
    () => window.dispatchEvent(new CustomEvent('aide:workspace-cycle', { detail: { direction: -1 } })),
  )

  registerCommand(
    { id: 'editor.symbolSearch', label: 'Go to Symbol', category: 'Editor' },
    () => showToast('Symbol search requires LSP (coming in Phase 3)'),
  )

  registerCommand(
    { id: 'editor.toggleInlineDiff', label: 'Toggle Inline Diff', category: 'Editor' },
    () => window.dispatchEvent(new CustomEvent('aide:toggle-inline-diff')),
  )

  // Full .aide project initialization
  registerCommand(
    { id: 'aide.init', label: 'Initialize Project', category: 'aIDE' },
    async () => {
      const result = await window.api.aideInit()
      if ('error' in result) {
        showToast(result.error)
      } else {
        showToast(result.created
          ? `Initialized .aide/ for ${result.projectType} project`
          : `Project already initialized (${result.projectType})`,
        )
      }
    },
  )

  // Generate tasks.json from project config
  registerCommand(
    { id: 'aide.generateTasks', label: 'Generate Tasks', category: 'aIDE' },
    async () => {
      const result = await window.api.generateTasks()
      if ('error' in result) {
        showToast(result.error)
      } else {
        showToast('Generated .aide/tasks.json')
      }
    },
  )

  registerCommand(
    { id: 'gitignore.audit', label: 'Audit .gitignore Security', category: 'aIDE' },
    async () => {
      const result = await window.api.auditGitignore()
      if (result.missing.length === 0) {
        showToast('All security patterns are present in .gitignore')
      } else {
        window.dispatchEvent(
          new CustomEvent('aide:gitignore-audit', { detail: result }),
        )
      }
    },
  )

  registerCommand(
    { id: 'task.run', label: 'Run Task...', category: 'Task' },
    async () => {
      const { tasks, compounds } = await window.api.listTasks()
      const allItems = [
        ...tasks.map((t) => ({ id: t.id, label: t.label, group: t.group })),
        ...compounds.map((c) => ({ id: c.id, label: c.label, group: undefined })),
      ]
      if (allItems.length === 0) {
        showToast('No tasks defined. Create .aide/tasks.json to add tasks.')
        return
      }
      window.dispatchEvent(
        new CustomEvent('aide:task-picker', { detail: allItems }),
      )
    },
  )

  registerCommand(
    { id: 'task.runLast', label: 'Run Last Task', category: 'Task' },
    () => {
      window.dispatchEvent(new CustomEvent('aide:task-run-last'))
    },
  )

  registerCommand(
    { id: 'task.terminate', label: 'Terminate Task...', category: 'Task' },
    () => {
      window.dispatchEvent(new CustomEvent('aide:task-terminate'))
    },
  )

  registerCommand(
    { id: 'task.reloadTasks', label: 'Reload Tasks', category: 'Task' },
    async () => {
      await window.api.reloadTasks()
      showToast('Tasks reloaded')
    },
  )
}
