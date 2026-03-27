const MIN_ZOOM = 0.5
const MAX_ZOOM = 2
const ZOOM_STEP = 0.1

/**
 * Round a zoom factor to two decimal places.
 *
 * @param value - The zoom factor to round
 * @returns The zoom factor rounded to two decimal places
 */
export function roundZoomFactor(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Clamp and normalize a zoom factor to the allowed range.
 *
 * Rounds `value` to two decimal places and constrains it to the interval defined by `MIN_ZOOM` and `MAX_ZOOM`.
 *
 * @param value - The zoom factor to normalize
 * @returns The normalized zoom factor (rounded to two decimals and clamped to `[MIN_ZOOM, MAX_ZOOM]`); returns `1` if `value` is not finite
 */
export function clampZoomFactor(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, roundZoomFactor(value)))
}

/**
 * Adjusts a zoom factor by a given delta and enforces the configured bounds.
 *
 * @param current - The current zoom factor (1 is the default/unzoomed value)
 * @param delta - The amount to add to `current`; may be positive or negative
 * @returns The resulting zoom factor, rounded to two decimal places and clamped to the allowed range
 */
export function adjustZoomFactor(current: number, delta: number): number {
  return clampZoomFactor(current + delta)
}

/**
 * Changes the zoom factor by one step in the specified direction.
 *
 * @param current - The current zoom factor
 * @param direction - `1` to increase the zoom, `-1` to decrease it
 * @returns The updated zoom factor, rounded to two decimal places and clamped to the allowed range
 */
export function stepZoomFactor(current: number, direction: -1 | 1): number {
  return adjustZoomFactor(current, ZOOM_STEP * direction)
}

/**
 * Return the default zoom factor.
 *
 * @returns The default zoom factor `1`.
 */
export function resetZoomFactor(): number {
  return 1
}

/**
 * Convert a zoom factor into a rounded percentage value.
 *
 * @param value - Zoom factor where `1` equals 100%
 * @returns The zoom percentage as an integer (`zoom factor × 100`) after clamping to the allowed range. Non-finite inputs are treated as `1` (100%).
 */
export function zoomFactorToPercent(value: number): number {
  return Math.round(clampZoomFactor(value) * 100)
}

/**
 * Format a zoom factor as a CSS-ready numeric string with two decimal places.
 *
 * @param value - Zoom factor where `1` represents 100% zoom
 * @returns The input clamped to the allowed zoom range and formatted with exactly two decimal places (e.g. "1.00")
 */
export function zoomFactorToCssValue(value: number): string {
  return clampZoomFactor(value).toFixed(2)
}

export const zoomLimits = {
  min: MIN_ZOOM,
  max: MAX_ZOOM,
  step: ZOOM_STEP,
}
