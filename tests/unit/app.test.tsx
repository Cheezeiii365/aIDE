import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@renderer/hooks/useTheme'
import { EditorStatusProvider } from '@renderer/hooks/useEditorStatus'
import { App } from '@renderer/App'
import type { WindowApi } from '@aide/shared'

// Mock window.api for tests — derives from WindowApi so it breaks at
// compile time if the contract changes.
const mockApi: WindowApi = {
  minimizeWindow: vi.fn(),
  maximizeWindow: vi.fn(),
  closeWindow: vi.fn(),
  getTheme: vi.fn().mockResolvedValue('one-dark'),
  setTheme: vi.fn().mockResolvedValue(undefined),
  onThemeChanged: vi.fn().mockReturnValue(() => {}),
  onFullscreenChanged: vi.fn().mockReturnValue(() => {}),
  getSidebarWidth: vi.fn().mockResolvedValue(220),
  setSidebarWidth: vi.fn().mockResolvedValue(undefined),
  openWorkspaceDialog: vi.fn().mockResolvedValue(null),
  getWorkspaceRoot: vi.fn().mockResolvedValue(null),
  readDir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue({ content: '' }),
  writeFile: vi.fn().mockResolvedValue({ success: true }),
  ptyCreate: vi.fn().mockResolvedValue({ id: 'mock-pty-id' }),
  ptyWrite: vi.fn(),
  ptyResize: vi.fn(),
  ptyKill: vi.fn(),
  onPtyData: vi.fn().mockReturnValue(() => {}),
  onPtyExit: vi.fn().mockReturnValue(() => {}),
  platform: 'darwin',
}

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    value: mockApi,
    writable: true,
  })
})

function renderApp() {
  return render(
    <ThemeProvider>
      <EditorStatusProvider>
        <App />
      </EditorStatusProvider>
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
