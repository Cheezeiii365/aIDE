import type { IDockviewPanelProps } from 'dockview-react'

export function PlaceholderPane({ params }: IDockviewPanelProps<{ title: string; zoomFactor?: number }>) {
  return (
    <div className="placeholder-pane" style={{ ['--panel-zoom' as string]: String(params.zoomFactor ?? 1) }}>
      <span className="placeholder-pane__title">{params.title}</span>
    </div>
  )
}
