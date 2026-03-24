import type { IDockviewPanelProps } from 'dockview-react'

export function PlaceholderPane({ params }: IDockviewPanelProps<{ title: string }>) {
  return (
    <div className="placeholder-pane">
      <span className="placeholder-pane__title">{params.title}</span>
    </div>
  )
}
