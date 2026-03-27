import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
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
  getBrowserZoom: vi.fn().mockResolvedValue(1),
  setBrowserZoom: vi.fn().mockResolvedValue(1),
  adjustBrowserZoom: vi.fn().mockResolvedValue(1),
  onZoomCommand: vi.fn().mockReturnValue(() => {}),
  getSidebarWidth: vi.fn().mockResolvedValue(220),
  setSidebarWidth: vi.fn().mockResolvedValue(undefined),
  openWorkspaceDialog: vi.fn().mockResolvedValue(null),
  getWorkspaceRoot: vi.fn().mockResolvedValue(null),
  readDir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue({ content: '' }),
  writeFile: vi.fn().mockResolvedValue({ success: true }),
  createFile: vi.fn().mockResolvedValue({ success: true }),
  createDir: vi.fn().mockResolvedValue({ success: true }),
  deleteEntry: vi.fn().mockResolvedValue({ success: true }),
  renameEntry: vi.fn().mockResolvedValue({ success: true }),
  revealInFinder: vi.fn(),
  onFsWatchEvent: vi.fn().mockReturnValue(() => {}),
  getGitStatus: vi.fn().mockResolvedValue(null),
  onGitStatusChanged: vi.fn().mockReturnValue(() => {}),
  onGitBranchChanged: vi.fn().mockReturnValue(() => {}),
  ptyCreate: vi.fn().mockResolvedValue({ id: 'mock-pty-id' }),
  ptyWrite: vi.fn(),
  ptyResize: vi.fn(),
  ptyKill: vi.fn(),
  ptyKillWorkspace: vi.fn(),
  onPtyData: vi.fn().mockReturnValue(() => {}),
  onPtyExit: vi.fn().mockReturnValue(() => {}),
  listWorktrees: vi.fn().mockResolvedValue([]),
  createWorktree: vi.fn().mockResolvedValue({ path: '/tmp/worktree' }),
  removeWorktree: vi.fn().mockResolvedValue({ success: true }),
  setActiveWorktree: vi.fn().mockResolvedValue(undefined),
  getActiveWorktree: vi.fn().mockResolvedValue(null),
  onWorktreeListChanged: vi.fn().mockReturnValue(() => {}),
  listBranches: vi.fn().mockResolvedValue([]),
  listAllFiles: vi.fn().mockResolvedValue([]),
  searchStart: vi.fn().mockResolvedValue(undefined),
  onSearchResults: vi.fn().mockReturnValue(() => {}),
  onSearchComplete: vi.fn().mockReturnValue(() => {}),
  searchCancel: vi.fn(),
  searchReplace: vi.fn().mockResolvedValue({ success: true }),
  aideInit: vi.fn().mockResolvedValue({ projectType: 'unknown', created: false, rootPath: '/tmp' }),
  getResolvedSettings: vi.fn().mockResolvedValue({
    tabSize: 2,
    insertSpaces: true,
    wordWrap: 'off',
    rulers: [],
    fontSize: 14,
    fontFamily: 'monospace',
    formatOnSave: false,
    filesExclude: {},
    searchExclude: {},
  }),
  onAideInitResult: vi.fn().mockReturnValue(() => {}),
  auditGitignore: vi.fn().mockResolvedValue({ missing: [], total: 0 }),
  appendToGitignore: vi.fn().mockResolvedValue(undefined),
  dismissGitignoreAudit: vi.fn().mockResolvedValue(undefined),
  onGitignoreAuditResult: vi.fn().mockReturnValue(() => {}),
  listTasks: vi.fn().mockResolvedValue({ tasks: [], compounds: [] }),
  runTask: vi.fn().mockResolvedValue({ executionId: 'exec-1' }),
  killTask: vi.fn(),
  reloadTasks: vi.fn().mockResolvedValue(undefined),
  generateTasks: vi.fn().mockResolvedValue({ success: true }),
  provideTaskInput: vi.fn(),
  onTaskStatusChanged: vi.fn().mockReturnValue(() => {}),
  onTaskRequestInput: vi.fn().mockReturnValue(() => {}),
  onTaskDiagnostics: vi.fn().mockReturnValue(() => {}),
  onTaskAutoDetect: vi.fn().mockReturnValue(() => {}),
  listWorkspaces: vi.fn().mockResolvedValue([]),
  createWorkspace: vi.fn().mockResolvedValue({
    id: 'ws-1',
    name: 'Workspace',
    rootPath: null,
    createdAt: 0,
    lastOpenedAt: 0,
  }),
  createBlankWorkspace: vi.fn().mockResolvedValue({
    id: 'ws-blank',
    name: 'Untitled',
    rootPath: null,
    createdAt: 0,
    lastOpenedAt: 0,
  }),
  removeWorkspace: vi.fn().mockResolvedValue(undefined),
  closeWorkspace: vi.fn().mockResolvedValue(undefined),
  switchWorkspace: vi.fn().mockResolvedValue(undefined),
  updateWorkspace: vi.fn().mockResolvedValue(undefined),
  reorderWorkspaces: vi.fn().mockResolvedValue(undefined),
  setWorkspaceRoot: vi.fn().mockResolvedValue(undefined),
  getActiveWorkspaceId: vi.fn().mockResolvedValue(null),
  onWorkspaceRegistryChanged: vi.fn().mockReturnValue(() => {}),
  saveWorkspaceState: vi.fn().mockResolvedValue(undefined),
  loadWorkspaceState: vi.fn().mockResolvedValue(null),
  saveTerminalState: vi.fn().mockResolvedValue(undefined),
  loadTerminalState: vi.fn().mockResolvedValue(null),
  browserCreate: vi.fn().mockResolvedValue({ success: true }),
  browserDestroy: vi.fn(),
  browserDestroyWorkspace: vi.fn(),
  browserNavigate: vi.fn().mockResolvedValue({ success: true, url: 'https://example.com/' }),
  browserGoBack: vi.fn(),
  browserGoForward: vi.fn(),
  browserReload: vi.fn(),
  browserHostUpdate: vi.fn(),
  browserSuppressOverlays: vi.fn(),
  browserUnsuppressOverlays: vi.fn(),
  onBrowserDidNavigate: vi.fn().mockReturnValue(() => {}),
  onBrowserTitleUpdated: vi.fn().mockReturnValue(() => {}),
  onBrowserLoadingChanged: vi.fn().mockReturnValue(() => {}),
  onBrowserCanNavigateChanged: vi.fn().mockReturnValue(() => {}),
  onBrowserFocusChanged: vi.fn().mockReturnValue(() => {}),
  onLifecycleRequestSave: vi.fn().mockReturnValue(() => {}),
  lifecycleSaveComplete: vi.fn(),
  onCrashDetected: vi.fn().mockReturnValue(() => {}),
  platform: 'darwin',
}

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    value: mockApi,
    writable: true,
  })
})

async function renderApp() {
  let result: ReturnType<typeof render> | undefined
  await act(async () => {
    result = render(
      <ThemeProvider>
        <EditorStatusProvider>
          <App />
        </EditorStatusProvider>
      </ThemeProvider>,
    )
    await Promise.resolve()
  })
  return result!
}

describe('App', () => {
  it('renders the app shell layout', async () => {
    const { container } = await renderApp()
    expect(container.querySelector('.app-shell')).toBeInTheDocument()
  })

  it('renders the workspace ribbon with drag region', async () => {
    const { container } = await renderApp()
    expect(container.querySelector('.workspace-ribbon')).toBeInTheDocument()
  })

  it('renders the sidebar', async () => {
    const { container } = await renderApp()
    expect(container.querySelector('.sidebar')).toBeInTheDocument()
  })

  it('renders the status bar', async () => {
    await renderApp()
    expect(screen.getByText('UTF-8')).toBeInTheDocument()
  })
})
