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

/**
 * Generate a unique identifier string for browser panels.
 *
 * @returns A unique identifier string; uses a UUID when available, otherwise a fallback string prefixed with `browser-`
 */
function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/**
 * Create a BrowserPanelParams object prepopulated for the given workspace and session.
 *
 * @param workspaceId - The identifier of the workspace this panel belongs to
 * @param sessionMode - The browser session mode for the panel
 * @param url - Optional initial URL to load in the panel (defaults to `''`)
 * @returns A BrowserPanelParams with a generated `paneId`, the provided `workspaceId` and `sessionMode`, `url` set to the provided value, `hasLoadedOnce` set to `false`, and `zoomFactor` set to `1`
 */
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

/**
 * Determines whether a dockview panel contains browser panel parameters.
 *
 * @param panel - Object with a `params` property to validate
 * @returns `true` if `params` includes `paneId`, `workspaceId`, and `sessionMode` as strings, `false` otherwise.
 */
export function isBrowserPanel(panel: { params: unknown }): boolean {
  const params = panel.params as Partial<BrowserPanelParams> | undefined
  return typeof params?.paneId === 'string' && typeof params?.workspaceId === 'string' && typeof params?.sessionMode === 'string'
}

/**
 * Get the panel's BrowserPanelParams when its `params` object conforms to that shape.
 *
 * @param panel - The object containing a `params` property (typically a dockview panel)
 * @returns The panel's `BrowserPanelParams` when `panel.params` is valid, `null` otherwise.
 */
export function getBrowserParams(panel: { params: unknown }): BrowserPanelParams | null {
  if (!isBrowserPanel(panel)) return null
  return panel.params as BrowserPanelParams
}

/**
 * Collects browser panel state for panels that belong to the specified workspace.
 *
 * @param dockviewApi - The Dockview API instance whose panels will be inspected; when `null` no panels are processed.
 * @param workspaceId - The workspace identifier used to filter panels; when `null` no panels are processed.
 * @returns An array of `BrowserPaneState` objects for panels whose `workspaceId` matches the provided `workspaceId`, or an empty array if there are no matches or required inputs are missing.
 */
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
