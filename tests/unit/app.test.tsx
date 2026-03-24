import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@renderer/hooks/useTheme'
import { App } from '@renderer/App'

// Mock window.api for tests
beforeEach(() => {
  Object.defineProperty(window, 'api', {
    value: {
      minimizeWindow: vi.fn(),
      maximizeWindow: vi.fn(),
      closeWindow: vi.fn(),
      getTheme: vi.fn().mockResolvedValue('one-dark'),
      setTheme: vi.fn().mockResolvedValue(undefined),
      onThemeChanged: vi.fn().mockReturnValue(() => {}),
      onFullscreenChanged: vi.fn().mockReturnValue(() => {}),
      platform: 'darwin',
    },
    writable: true,
  })
})

function renderApp() {
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  )
}

describe('App', () => {
  it('renders the app shell layout', () => {
    const { container } = renderApp()
    expect(container.querySelector('.app-shell')).toBeInTheDocument()
  })

  it('renders the workspace ribbon with drag region', () => {
    const { container } = renderApp()
    expect(container.querySelector('.workspace-ribbon')).toBeInTheDocument()
  })

  it('renders the sidebar', () => {
    renderApp()
    expect(screen.getByText('Explorer')).toBeInTheDocument()
  })

  it('renders the status bar', () => {
    renderApp()
    expect(screen.getByText('UTF-8')).toBeInTheDocument()
  })
})
