const MIN_ZOOM = 0.5
const MAX_ZOOM = 2
const ZOOM_STEP = 0.1

export function roundZoomFactor(value: number): number {
  return Math.round(value * 100) / 100
}

export function clampZoomFactor(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, roundZoomFactor(value)))
}

export function adjustZoomFactor(current: number, delta: number): number {
  return clampZoomFactor(current + delta)
}

export function stepZoomFactor(current: number, direction: -1 | 1): number {
  return adjustZoomFactor(current, ZOOM_STEP * direction)
}

export function resetZoomFactor(): number {
  return 1
}

export function zoomFactorToPercent(value: number): number {
  return Math.round(clampZoomFactor(value) * 100)
}

export function zoomFactorToCssValue(value: number): string {
  return clampZoomFactor(value).toFixed(2)
}

export const zoomLimits = {
  min: MIN_ZOOM,
  max: MAX_ZOOM,
  step: ZOOM_STEP,
}
