import type { DockviewApi } from 'dockview-react'
import type { BrowserPaneState, BrowserSessionMode } from '@aide/shared'

export interface BrowserPanelParams {
  paneId: string
  workspaceId: string
  sessionMode: BrowserSessionMode
  url: string
  hasLoadedOnce: boolean
  zoomFactor: number
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createBrowserPanelParams(
  workspaceId: string,
  sessionMode: BrowserSessionMode,
  url = '',
): BrowserPanelParams {
  return {
    paneId: randomId(),
    workspaceId,
    sessionMode,
    url,
    hasLoadedOnce: false,
    zoomFactor: 1,
  }
}

export function isBrowserPanel(panel: { params: unknown }): boolean {
  const params = panel.params as Partial<BrowserPanelParams> | undefined
  return typeof params?.paneId === 'string' && typeof params?.workspaceId === 'string' && typeof params?.sessionMode === 'string'
}

export function getBrowserParams(panel: { params: unknown }): BrowserPanelParams | null {
  if (!isBrowserPanel(panel)) return null
  return panel.params as BrowserPanelParams
}

export function serializeBrowserPaneState(
  dockviewApi: DockviewApi | null,
  workspaceId: string | null,
): BrowserPaneState[] {
  if (!dockviewApi || !workspaceId) return []

  return dockviewApi.panels
    .map((panel) => getBrowserParams(panel))
    .filter((params): params is BrowserPanelParams => params?.workspaceId === workspaceId)
    .map((params) => ({
      paneId: params.paneId,
      workspaceId: params.workspaceId,
      sessionMode: params.sessionMode,
      url: params.url,
      hasLoadedOnce: params.hasLoadedOnce,
      zoomFactor: params.zoomFactor,
    }))
}
