import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'ghost' | 'outline' | 'accent' | 'danger'
type ButtonSize = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  children?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'md', className, children, type = 'button', ...rest },
  ref,
) {
  const cls = `ui-btn ui-btn--${variant} ui-btn--${size}${className ? ` ${className}` : ''}`
  return (
    <button ref={ref} type={type} className={cls} {...rest}>
      {children}
    </button>
  )
})
