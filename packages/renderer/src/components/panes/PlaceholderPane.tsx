import type { IDockviewPanelProps } from 'dockview-react'

/**
 * Renders a placeholder pane that displays a title and applies an optional zoom factor.
 *
 * @param params - Panel parameters: `title` is rendered as the pane's label; `zoomFactor`, if provided, is used to set the pane's zoom via the `--panel-zoom` CSS custom property (defaults to `1`)
 * @returns The rendered placeholder pane element
 */
export function PlaceholderPane({ params }: IDockviewPanelProps<{ title: string; zoomFactor?: number }>) {
  return (
    <div className="placeholder-pane" style={{ ['--panel-zoom' as string]: String(params.zoomFactor ?? 1) }}>
      <span className="placeholder-pane__title">{params.title}</span>
    </div>
  )
}
