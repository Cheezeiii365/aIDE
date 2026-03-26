import type { DockviewApi } from 'dockview-react'
import type { AideLocalTerminals, TerminalState } from '@aide/shared'

export interface TerminalPanelParams {
  terminalId: string
  workspaceId?: string
  worktreePath?: string
  shell?: string
  title?: string
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `terminal-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

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
  }
}

export function isTerminalPanel(panel: { params: unknown }): boolean {
  const params = panel.params as Partial<TerminalPanelParams> | undefined
  return typeof params?.terminalId === 'string' && params.terminalId.length > 0
}

export function getTerminalParams(panel: { params: unknown }): TerminalPanelParams | null {
  if (!isTerminalPanel(panel)) return null
  return panel.params as TerminalPanelParams
}

export function serializeTerminalState(dockviewApi: DockviewApi | null): AideLocalTerminals {
  const terminals: TerminalState[] = []
  let activeTerminalId: string | null = null

  if (!dockviewApi) {
    return { terminals, activeTerminalId }
  }

  for (const panel of dockviewApi.panels) {
    const params = getTerminalParams(panel)
    if (!params?.workspaceId) continue

    terminals.push({
      id: params.terminalId,
      workspaceId: params.workspaceId,
      cwd: params.worktreePath || '',
      shell: params.shell,
      title: params.title || 'Terminal',
    })
  }

  const activeParams = dockviewApi.activePanel ? getTerminalParams(dockviewApi.activePanel) : null
  if (activeParams?.terminalId) {
    activeTerminalId = activeParams.terminalId
  }

  return { terminals, activeTerminalId }
}
