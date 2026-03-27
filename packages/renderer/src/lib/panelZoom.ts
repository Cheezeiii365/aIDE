import { clampZoomFactor } from '@aide/shared'

export interface PanelZoomParams {
  zoomFactor?: number
}

export function getPanelZoomFactor(params: unknown): number {
  const zoomFactor = (params as PanelZoomParams | undefined)?.zoomFactor
  return typeof zoomFactor === 'number' ? clampZoomFactor(zoomFactor) : 1
}

export function updatePanelZoomParams<T extends Record<string, unknown>>(params: T | undefined, zoomFactor: number): T & PanelZoomParams {
  return {
    ...(params ?? {}),
    zoomFactor: clampZoomFactor(zoomFactor),
  } as T & PanelZoomParams
}
