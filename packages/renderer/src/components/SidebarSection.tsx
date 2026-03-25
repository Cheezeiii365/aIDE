import { useState, type ReactNode } from 'react'

interface Props {
  title: string
  defaultExpanded?: boolean
  actions?: ReactNode
  children: ReactNode
}

export function SidebarSection({ title, defaultExpanded = true, actions, children }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className={`sidebar-section ${expanded ? 'sidebar-section--expanded' : 'sidebar-section--collapsed'}`}>
      <div className="sidebar-section__header" onClick={() => setExpanded(!expanded)}>
        <svg
          className={`sidebar-section__chevron ${!expanded ? 'sidebar-section__chevron--collapsed' : ''}`}
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
        <span className="sidebar-section__title">{title}</span>
        {actions && (
          <div className="sidebar-section__actions" onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
        )}
      </div>
      <div className="sidebar-section__body">
        {children}
      </div>
    </div>
  )
}
