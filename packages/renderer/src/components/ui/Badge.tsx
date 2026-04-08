import type { ReactNode } from 'react'

type BadgeVariant = 'neutral' | 'success' | 'warning' | 'error' | 'info'

interface BadgeProps {
  variant?: BadgeVariant
  icon?: ReactNode
  title?: string
  children: ReactNode
}

export function Badge({ variant = 'neutral', icon, title, children }: BadgeProps) {
  return (
    <span className={`ui-badge ui-badge--${variant}`} title={title}>
      {icon != null && <span className="ui-badge__icon">{icon}</span>}
      <span className="ui-badge__label">{children}</span>
    </span>
  )
}
