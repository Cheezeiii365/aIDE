import type { DockviewApi } from 'dockview-react'
import type { AideLocalTerminals, TerminalState } from '@aide/shared'

export interface TerminalPanelParams {
  terminalId: string
  workspaceId?: string
  worktreePath?: string
  shell?: string
  title?: string
  zoomFactor?: number
  /** When set, attach to an existing PTY (task-owned) instead of creating a new one. */
  taskPtyId?: string
  /** The task execution ID this terminal is bound to. */
  taskExecutionId?: string
  /** The task ID this terminal is bound to (for dedicated panel reuse). */
  taskId?: string
}

/**
 * Generate a stable identifier string for a terminal panel.
 *
 * @returns A string identifier; prefers `crypto.randomUUID()` when available, otherwise a fallback composed of the current timestamp and a random hex fragment.
 */
function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `terminal-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/**
 * Create parameters for a new terminal panel with a generated terminalId.
 *
 * The returned params include any provided metadata and a default zoomFactor of 1.
 *
 * @param workspaceId - Workspace identifier to associate the terminal with
 * @param worktreePath - Working directory path for the terminal (cwd)
 * @param title - Optional display title for the terminal panel
 * @returns A `TerminalPanelParams` object with a generated `terminalId`, the supplied fields, and `zoomFactor` set to `1`
 */
export function createTerminalPanelParams(
  workspaceId?: string,
  worktreePath?: string,
  title?: string,
): TerminalPanelParams {
  return {
    terminalId: randomId(),
    workspaceId,
    worktreePath,
    title,
    zoomFactor: 1,
  }
}

/**
 * Create terminal panel parameters for restoring an existing terminal.
 *
 * @param terminalId - The unique identifier of the terminal to restore
 * @param workspaceId - Optional workspace identifier associated with the terminal
 * @param worktreePath - Optional working directory path for the terminal
 * @param title - Optional display title for the terminal panel
 * @param shell - Optional shell executable or command for the terminal
 * @returns A TerminalPanelParams object populated from the provided values; `zoomFactor` is set to 1
 */
export function createRestoredTerminalPanelParams(
  terminalId: string,
  workspaceId?: string,
  worktreePath?: string,
  title?: string,
  shell?: string,
): TerminalPanelParams {
  return {
    terminalId,
    workspaceId,
    worktreePath,
    title,
    shell,
    zoomFactor: 1,
  }
}

/**
 * Determines whether a given panel represents a terminal by checking for a valid terminal ID.
 *
 * @param panel - An object with a `params` property to inspect for terminal information
 * @returns `true` if `panel.params` contains a non-empty `terminalId` string, `false` otherwise
 */
export function isTerminalPanel(panel: { params: unknown }): boolean {
  const params = panel.params as Partial<TerminalPanelParams> | undefined
  return typeof params?.terminalId === 'string' && params.terminalId.length > 0
}

/**
 * Retrieve terminal panel parameters from a panel object if they represent a terminal.
 *
 * @param panel - Object containing a `params` property that may hold terminal parameters
 * @returns `TerminalPanelParams` when `panel.params` contains a valid terminal `terminalId`, `null` otherwise
 */
export function getTerminalParams(panel: { params: unknown }): TerminalPanelParams | null {
  if (!isTerminalPanel(panel)) return null
  return panel.params as TerminalPanelParams
}

/**
 * Collects terminal panel state from a Dockview API for local serialization.
 *
 * @param dockviewApi - The Dockview API instance or `null`. When `null`, no panels are collected.
 * @returns An object with `terminals` (array of collected terminal states for panels that include a `workspaceId`) and `activeTerminalId` (the `terminalId` of the active panel if present, otherwise `null`).
 */
export function serializeTerminalState(dockviewApi: DockviewApi | null): AideLocalTerminals {
  const terminals: TerminalState[] = []
  let activeTerminalId: string | null = null

  if (!dockviewApi) {
    return { terminals, activeTerminalId }
  }

  for (const panel of dockviewApi.panels) {
    const params = getTerminalParams(panel)
    if (!params?.workspaceId) continue
    if (params.taskExecutionId || params.taskPtyId || params.taskId) continue

    terminals.push({
      id: params.terminalId,
      workspaceId: params.workspaceId,
      cwd: params.worktreePath || '',
      shell: params.shell,
      title: params.title || 'Terminal',
    })
  }

  const activeParams = dockviewApi.activePanel ? getTerminalParams(dockviewApi.activePanel) : null
  if (
    activeParams?.terminalId &&
    !activeParams.taskExecutionId &&
    !activeParams.taskPtyId &&
    !activeParams.taskId
  ) {
    activeTerminalId = activeParams.terminalId
  }

  return { terminals, activeTerminalId }
}
