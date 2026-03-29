import { BaseWindow, WebContentsView, shell, session as electronSession } from 'electron'
import { IpcChannels, adjustZoomFactor, clampZoomFactor } from '@aide/shared'
import type {
  BrowserCanNavigatePayload,
  BrowserDidNavigatePayload,
  BrowserFocusPayload,
  BrowserHostUpdate,
  BrowserLoadingPayload,
  BrowserPageTitlePayload,
  BrowserSessionMode,
} from '@aide/shared'

interface ManagedBrowserPane {
  view: WebContentsView
  workspaceId: string
  sessionMode: BrowserSessionMode
  currentUrl: string
  lastBounds: { x: number; y: number; width: number; height: number }
  desiredVisible: boolean
  appliedVisible: boolean
  hasLoadedOnce: boolean
  zoomFactor: number
}

interface BrowserPaneManagerOptions {
  getWindow: () => BaseWindow | null
  getRendererWebContents: () => Electron.WebContents | null
}

const EMPTY_BOUNDS = { x: 0, y: 0, width: 0, height: 0 }

/**
 * Normalize a user-provided URL or hostname into a fully qualified URL string.
 *
 * Trims surrounding whitespace and returns an empty string when the trimmed input is empty.
 * If the trimmed input is already a valid URL, returns its canonical string form.
 * Otherwise, prepends `https://` to the trimmed input and returns the resulting URL string.
 *
 * @param input - The raw URL or hostname provided by the user
 * @returns `''` when `input` is empty after trimming; otherwise the fully qualified URL string
 */
function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''

  try {
    return new URL(trimmed).toString()
  } catch {
    return new URL(`https://${trimmed}`).toString()
  }
}

/**
 * Determines whether the given URL should be opened externally rather than in-app.
 *
 * @returns `true` if the URL uses a protocol other than `http:`, `https:`, `file:`, or `about:`; `false` if it uses one of those protocols or cannot be parsed as a URL.
 */
function shouldOpenExternally(url: string): boolean {
  try {
    const parsed = new URL(url)
    return !['http:', 'https:', 'file:', 'about:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

function scaleBoundsToContentView(
  bounds: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  contentBounds: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const scaleX = viewport.width > 0 ? contentBounds.width / viewport.width : 1
  const scaleY = viewport.height > 0 ? contentBounds.height / viewport.height : 1

  return {
    x: Math.round(bounds.x * scaleX),
    y: Math.round(bounds.y * scaleY),
    width: Math.max(0, Math.round(bounds.width * scaleX)),
    height: Math.max(0, Math.round(bounds.height * scaleY)),
  }
}

export class BrowserPaneManager {
  private panes = new Map<string, ManagedBrowserPane>()

  private isSuppressed = false

  constructor(private readonly options: BrowserPaneManagerOptions) {}

  create(paneId: string, workspaceId: string, sessionMode: BrowserSessionMode): { success: true } | { error: string } {
    const existing = this.panes.get(paneId)
    if (existing) {
      if (existing.workspaceId !== workspaceId || existing.sessionMode !== sessionMode) {
        this.destroy(paneId)
      } else {
        return { success: true }
      }
    }

    const window = this.options.getWindow()
    if (!window) return { error: 'Main window is not ready' }

    const browserSession = this.getSession(workspaceId, sessionMode)
    const view = new WebContentsView({
      webPreferences: {
        session: browserSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    const managed: ManagedBrowserPane = {
      view,
      workspaceId,
      sessionMode,
      currentUrl: '',
      lastBounds: { ...EMPTY_BOUNDS },
      desiredVisible: false,
      appliedVisible: false,
      hasLoadedOnce: false,
      zoomFactor: 1,
    }

    this.panes.set(paneId, managed)
    window.contentView.addChildView(view)
    view.setVisible(false)
    view.setBounds(EMPTY_BOUNDS)

    view.webContents.setWindowOpenHandler(({ url }) => {
      if (shouldOpenExternally(url)) {
        void shell.openExternal(url)
        return { action: 'deny' }
      }
      void this.loadUrl(paneId, url)
      return { action: 'deny' }
    })

    view.webContents.on('will-navigate', (event, url) => {
      if (shouldOpenExternally(url)) {
        event.preventDefault()
        void shell.openExternal(url)
      }
    })

    view.webContents.on('page-title-updated', (event, title) => {
      event.preventDefault()
      this.sendToRenderer(IpcChannels.BROWSER_PAGE_TITLE_UPDATED, {
        paneId,
        title,
      } satisfies BrowserPageTitlePayload)
    })

    view.webContents.on('did-navigate', (_event, url) => {
      managed.currentUrl = url
      managed.hasLoadedOnce = true
      this.sendToRenderer(IpcChannels.BROWSER_DID_NAVIGATE, {
        paneId,
        url,
      } satisfies BrowserDidNavigatePayload)
      this.emitCanNavigateState(paneId, managed)
    })

    view.webContents.on('did-navigate-in-page', (_event, url) => {
      managed.currentUrl = url
      this.sendToRenderer(IpcChannels.BROWSER_DID_NAVIGATE, {
        paneId,
        url,
      } satisfies BrowserDidNavigatePayload)
      this.emitCanNavigateState(paneId, managed)
    })

    view.webContents.on('did-start-loading', () => {
      this.sendToRenderer(IpcChannels.BROWSER_LOADING_CHANGED, {
        paneId,
        loading: true,
      } satisfies BrowserLoadingPayload)
    })

    view.webContents.on('did-stop-loading', () => {
      this.sendToRenderer(IpcChannels.BROWSER_LOADING_CHANGED, {
        paneId,
        loading: false,
      } satisfies BrowserLoadingPayload)
      this.emitCanNavigateState(paneId, managed)
    })

    view.webContents.on('focus', () => {
      this.sendToRenderer(IpcChannels.BROWSER_FOCUS_CHANGED, {
        paneId,
        focused: true,
      } satisfies BrowserFocusPayload)
    })

    view.webContents.on('blur', () => {
      this.sendToRenderer(IpcChannels.BROWSER_FOCUS_CHANGED, {
        paneId,
        focused: false,
      } satisfies BrowserFocusPayload)
    })

    view.webContents.setZoomFactor(1)

    return { success: true }
  }

  destroy(paneId: string): void {
    const managed = this.panes.get(paneId)
    if (!managed) return

    this.panes.delete(paneId)
    const window = this.options.getWindow()
    try {
      window?.contentView.removeChildView(managed.view)
    } catch {
      // View may already be detached.
    }
    managed.view.webContents.close({ waitForBeforeUnload: false })
  }

  destroyWorkspace(workspaceId: string): void {
    for (const [paneId, managed] of this.panes.entries()) {
      if (managed.workspaceId === workspaceId) {
        this.destroy(paneId)
      }
    }
  }

  async navigate(paneId: string, url: string): Promise<{ success: true; url: string } | { error: string }> {
    const managed = this.panes.get(paneId)
    if (!managed) return { error: 'Browser pane not found' }

    const normalizedUrl = normalizeUrl(url)
    if (!normalizedUrl) return { error: 'Enter a URL to navigate' }

    if (shouldOpenExternally(normalizedUrl)) {
      void shell.openExternal(normalizedUrl)
      return { success: true, url: normalizedUrl }
    }

    managed.currentUrl = normalizedUrl

    try {
      await managed.view.webContents.loadURL(normalizedUrl)
      managed.hasLoadedOnce = true
      this.emitCanNavigateState(paneId, managed)
      return { success: true, url: normalizedUrl }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load URL'
      return { error: message }
    }
  }

  goBack(paneId: string): void {
    const managed = this.panes.get(paneId)
    if (managed?.view.webContents.canGoBack()) {
      managed.view.webContents.goBack()
    }
  }

  goForward(paneId: string): void {
    const managed = this.panes.get(paneId)
    if (managed?.view.webContents.canGoForward()) {
      managed.view.webContents.goForward()
    }
  }

  reload(paneId: string): void {
    this.panes.get(paneId)?.view.webContents.reload()
  }

  getZoom(paneId: string): number {
    return this.panes.get(paneId)?.zoomFactor ?? 1
  }

  setZoom(paneId: string, zoomFactor: number): number {
    const managed = this.panes.get(paneId)
    if (!managed) return 1
    const nextZoom = clampZoomFactor(zoomFactor)
    managed.zoomFactor = nextZoom
    managed.view.webContents.setZoomFactor(nextZoom)
    return nextZoom
  }

  adjustZoom(paneId: string, delta: number): number {
    const managed = this.panes.get(paneId)
    if (!managed) return 1
    return this.setZoom(paneId, adjustZoomFactor(managed.zoomFactor, delta))
  }

  handleHostUpdate(update: BrowserHostUpdate): void {
    const managed = this.panes.get(update.paneId)
    if (!managed) return

    managed.workspaceId = update.workspaceId

    const window = this.options.getWindow()
    const windowContentBounds = window?.getContentBounds() ?? null
    const scaledBounds = windowContentBounds
      ? scaleBoundsToContentView(update.bounds, update.viewport, windowContentBounds)
      : {
          x: Math.round(update.bounds.x),
          y: Math.round(update.bounds.y),
          width: Math.max(0, Math.round(update.bounds.width)),
          height: Math.max(0, Math.round(update.bounds.height)),
        }

    const nextBounds = scaledBounds
    const nextDesiredVisible = update.visible && nextBounds.width > 0 && nextBounds.height > 0

    if (!sameBounds(managed.lastBounds, nextBounds)) {
      managed.lastBounds = nextBounds
      managed.view.setBounds(nextBounds)
    }

    managed.desiredVisible = nextDesiredVisible
    const nextAppliedVisible = nextDesiredVisible && !this.isSuppressed
    if (managed.appliedVisible !== nextAppliedVisible) {
      managed.appliedVisible = nextAppliedVisible
      managed.view.setVisible(nextAppliedVisible)
    }
  }

  suppressOverlays(): void {
    this.isSuppressed = true
    for (const managed of this.panes.values()) {
      if (managed.appliedVisible) {
        managed.appliedVisible = false
        managed.view.setVisible(false)
      }
    }
  }

  unsuppressOverlays(): void {
    this.isSuppressed = false
    for (const managed of this.panes.values()) {
      const nextAppliedVisible = managed.desiredVisible
      if (managed.appliedVisible !== nextAppliedVisible) {
        managed.appliedVisible = nextAppliedVisible
        managed.view.setVisible(nextAppliedVisible)
      }
    }
  }

  async getPageContent(paneId?: string, selector?: string): Promise<string | null> {
    const managed = paneId
      ? this.panes.get(paneId)
      : this.panes.values().next().value
    if (!managed) return null
    const js = selector
      ? `document.querySelector(${JSON.stringify(selector)})?.innerText ?? ''`
      : `document.body.innerText`
    return managed.view.webContents.executeJavaScript(js)
  }

  private getSession(workspaceId: string, sessionMode: BrowserSessionMode): Electron.Session {
    switch (sessionMode) {
      case 'shared-auth':
        return electronSession.fromPartition('persist:auth')
      case 'workspace':
        return electronSession.fromPartition(`persist:workspace-${workspaceId}`)
      case 'temporary':
        return electronSession.fromPartition(`temp:browser-${workspaceId}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
      default:
        return electronSession.fromPartition(`persist:workspace-${workspaceId}`)
    }
  }

  private emitCanNavigateState(paneId: string, managed: ManagedBrowserPane): void {
    this.sendToRenderer(IpcChannels.BROWSER_CAN_NAVIGATE_CHANGED, {
      paneId,
      canGoBack: managed.view.webContents.canGoBack(),
      canGoForward: managed.view.webContents.canGoForward(),
    } satisfies BrowserCanNavigatePayload)
  }

  private sendToRenderer(channel: string, payload: unknown): void {
    this.options.getRendererWebContents()?.send(channel, payload)
  }

  private async loadUrl(paneId: string, url: string): Promise<void> {
    const managed = this.panes.get(paneId)
    if (!managed) return

    managed.currentUrl = url
    try {
      await managed.view.webContents.loadURL(url)
      managed.hasLoadedOnce = true
    } catch {
      // Ignore popup-triggered load failures; navigate() handles user-facing errors.
    }
  }
}

/**
 * Determines whether two bounding rectangles have identical x, y, width, and height.
 *
 * @param a - First bounds object
 * @param b - Second bounds object
 * @returns `true` if `a` and `b` have equal `x`, `y`, `width`, and `height`, `false` otherwise.
 */
function sameBounds(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}
