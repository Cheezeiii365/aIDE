/**
 * @fileoverview Types for the dependency object passed implicitly into every app-wide command.
 *
 * `AppShell` assigns a fresh implementation each layout pass into `commandContextRef`.
 * Domain modules receive `getCtx: GetCommandContext` and call `getCtx()` inside the handler so they
 * always read current Dockview, workspace, and UI state—never stale React closures from registration time.
 */

import type { DockviewApi } from 'dockview-react'
import type { GitignoreAuditResult, TaskExecution, WorkspaceEntry } from '@aide/shared'
import type { DockviewNavigation } from '../lib/dockviewNavigation'

/** One row in the Run Task picker (task or compound id + display label). */
export interface TaskPickerItem {
  id: string
  label: string
  /** Optional group label (e.g. task `group`) shown as secondary text in the picker. */
  group?: string
}

/**
 * Facade over AppShell/runtime services for command handlers. Grouped by concern:
 *
 * - **Dockview** — `getDockviewApi`, `getDockviewNavigation`
 * - **Workspace** — active id/root, worktree root for file search, workspace list, switch/cycle/close/open
 * - **UI chrome** — sidebar, palette, quick open, browser modal, markdown preview toggle
 * - **Persistence** — `persistWorkspaceRuntime` after panel changes that should be saved
 * - **Gitignore** — `presentGitignoreAudit` opens toast + review flow from audit results
 * - **Tasks** — pickers, run/kill/reload; `getLastTaskId` / `getRunningTasks` are ref-backed for correct keybinding timing
 */
export interface CommandContext {
  getDockviewApi: () => DockviewApi | null
  getDockviewNavigation: () => DockviewNavigation | null

  getActiveWorkspaceId: () => string | null
  getWorkspaceRoot: () => string | null
  /** Active worktree path when the file tree is rooted on a worktree; used e.g. for Find in Files scope. */
  getActiveWorktreeRoot: () => string | null
  getActiveBrowserPaneId: () => string | null
  getWorkspaces: () => WorkspaceEntry[]

  switchWorkspaceByIndex: (index: number) => void
  cycleWorkspace: (direction: 1 | -1) => void
  closeActiveWorkspace: () => void
  openFolder: () => void
  newBlankWorkspace: () => void

  toggleSidebar: () => void
  openCommandPalette: () => void
  openQuickOpen: () => void
  openNewBrowserModal: () => void
  openThemePicker: (mode: 'active' | 'dark' | 'light') => void
  toggleTheme: () => void
  reloadThemes: () => Promise<void>
  openThemesDirectory: () => Promise<void>

  persistWorkspaceRuntime: () => void

  presentGitignoreAudit: (result: GitignoreAuditResult) => void

  openTaskPicker: (items: TaskPickerItem[]) => void
  openTerminateTaskPicker: (executions: TaskExecution[]) => void
  runTaskById: (id: string) => void
  getLastTaskId: () => string | null
  getRunningTasks: () => TaskExecution[]
  killTaskByExecutionId: (executionId: string) => void
  reloadTasksDefinitions: () => Promise<void>

  /** Toggle markdown preview for the active editor when it is a `.md` file. */
  toggleMarkdownPreview: () => void
}

/**
 * Indirection so registered handlers always fetch the latest {@link CommandContext} from AppShell’s ref.
 */
export type GetCommandContext = () => CommandContext
