import { clampZoomFactor } from '@aide/shared'

export interface PanelZoomParams {
  zoomFactor?: number
}

/**
 * Extracts the panel zoom factor from an input value, defaulting to 1 when absent or not a number.
 *
 * @param params - An arbitrary value that may be a `PanelZoomParams`-like object; its `zoomFactor` property will be read if present.
 * @returns The numeric `zoomFactor` from `params` if it is a number, otherwise `1`.
 */
export function getPanelZoomFactor(params: unknown): number {
  const zoomFactor = (params as PanelZoomParams | undefined)?.zoomFactor
  return typeof zoomFactor === 'number' ? clampZoomFactor(zoomFactor) : 1
}

/**
 * Create a new params object with the specified panel zoom factor applied.
 *
 * @param params - Existing params to merge; may be `undefined`
 * @param zoomFactor - Zoom factor to set on the returned params
 * @returns An object containing all properties from `params` with `zoomFactor` set to the provided value
 */
export function updatePanelZoomParams<T extends Record<string, unknown>>(params: T | undefined, zoomFactor: number): T & PanelZoomParams {
  return {
    ...(params ?? {}),
    zoomFactor: clampZoomFactor(zoomFactor),
  } as T & PanelZoomParams
}
