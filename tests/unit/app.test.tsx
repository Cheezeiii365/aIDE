import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from '@renderer/App'

describe('App', () => {
  it('renders the app shell', () => {
    render(<App />)
    expect(screen.getByText('aIDE')).toBeInTheDocument()
    expect(screen.getByText('Shell is running.')).toBeInTheDocument()
  })

  it('includes a titlebar drag region', () => {
    const { container } = render(<App />)
    const dragRegion = container.querySelector('.titlebar-drag-region')
    expect(dragRegion).toBeInTheDocument()
  })
})
