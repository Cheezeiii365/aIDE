import { useCallback, useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { showToast } from '../Toast'
import type { BrowserCanNavigatePayload, BrowserDidNavigatePayload, BrowserLoadingPayload, BrowserPageTitlePayload } from '@aide/shared'
import type { BrowserPanelParams } from '../../lib/browserState'
import { adjustZoomFactor, resetZoomFactor, zoomFactorToPercent } from '@aide/shared'
import '../../styles/browser-pane.css'

/**
 * Produces a display title for a URL, preferring its hostname with fallbacks.
 *
 * @param url - The URL string to derive a title from; may be empty or invalid.
 * @returns The hostname extracted from `url`, `'Browser'` if `url` is falsy or has no hostname, or the original `url` if it cannot be parsed.
 */
function titleForUrl(url: string): string {
  if (!url) return 'Browser'
  try {
    return new URL(url).hostname || 'Browser'
  } catch {
    return url
  }
}

/**
 * Determines whether an error message indicates an aborted navigation.
 *
 * @param message - The error message text to inspect
 * @returns `true` if the message contains `ERR_ABORTED` (case-insensitive), `false` otherwise
 */
function isAbortError(message: string): boolean {
  return /ERR_ABORTED/i.test(message)
}

/**
 * Render a browser pane UI that embeds and controls a browser instance and synchronizes its state (bounds, visibility, navigation, title, loading, and zoom) with the host application.
 *
 * @param api - Panel API used to read/update panel parameters, set the panel title, and subscribe to panel events
 * @param containerApi - Container API used to observe layout changes
 * @param params - Initial and persisted panel parameters (e.g., url, zoomFactor, paneId, workspaceId, sessionMode, hasLoadedOnce)
 * @returns The React element for the browser pane, including navigation controls, URL entry, zoom controls, status display, and the browser host container
 */
export function BrowserPane({ api, containerApi, params }: IDockviewPanelProps<BrowserPanelParams>) {
  const hostRef = useRef<HTMLDivElement>(null)
  const chromeRef = useRef<HTMLDivElement>(null)
  const paramsRef = useRef<BrowserPanelParams | undefined>(params)
  const lastHostUpdateRef = useRef<string>('')
  const initialLoadRequestedRef = useRef(false)
  const browserReadyRef = useRef(false)
  const [urlInput, setUrlInput] = useState(params?.url ?? '')
  const [currentUrl, setCurrentUrl] = useState(params?.url ?? '')
  const [pageTitle, setPageTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [zoomFactor, setZoomFactor] = useState(params?.zoomFactor ?? 1)

  const paneId = params?.paneId ?? 'browser-pane'
  const workspaceId = params?.workspaceId ?? ''

  useEffect(() => {
    paramsRef.current = params
  }, [params])

  const pushHostUpdate = useCallback(() => {
    const host = hostRef.current
    if (!host || !workspaceId) return

    const rect = host.getBoundingClientRect()
    const next = {
      paneId,
      workspaceId,
      bounds: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      visible: rect.width > 0 && rect.height > 0,
      chromeHeight: chromeRef.current?.getBoundingClientRect().height ?? 0,
    }

    const serialized = JSON.stringify(next)
    if (serialized === lastHostUpdateRef.current) return
    lastHostUpdateRef.current = serialized
    window.api.browserHostUpdate(next)
  }, [paneId, workspaceId])

  const syncPanelParams = useCallback((nextUrl: string) => {
    const currentParams = paramsRef.current
    if (!currentParams) return
    if (currentParams.url === nextUrl && currentParams.hasLoadedOnce) return
    api.updateParameters({
      ...currentParams,
      paneId,
      workspaceId,
      url: nextUrl,
      hasLoadedOnce: true,
    })
  }, [api, paneId, workspaceId])

  const updateZoomFactor = useCallback(async (nextZoom: number) => {
    const currentParams = paramsRef.current
    if (!currentParams) return
    const appliedZoom = await window.api.setBrowserZoom(paneId, nextZoom)
    setZoomFactor(appliedZoom)
    api.updateParameters({
      ...currentParams,
      paneId,
      workspaceId,
      zoomFactor: appliedZoom,
    })
  }, [api, paneId, workspaceId])

  const commitNavigation = useCallback(async (rawUrl: string, retryCount = 0) => {
    const value = rawUrl.trim()
    const result = await window.api.browserNavigate(paneId, value)
    if ('error' in result) {
      initialLoadRequestedRef.current = false
      if (isAbortError(result.error) && retryCount === 0) {
        window.requestAnimationFrame(() => {
          void commitNavigation(rawUrl, 1)
        })
        return
      }
      if (!isAbortError(result.error)) showToast(result.error)
      return
    }

    setCurrentUrl(result.url)
    setUrlInput(result.url)
  }, [paneId])

  useEffect(() => {
    setUrlInput(params?.url ?? '')
    setCurrentUrl(params?.url ?? '')
    setZoomFactor(params?.zoomFactor ?? 1)
  }, [params?.url, params?.zoomFactor])

  const requestInitialLoad = useCallback(() => {
    const host = hostRef.current
    const currentParams = paramsRef.current
    if (!browserReadyRef.current || !host || !currentParams?.url || currentParams.hasLoadedOnce || initialLoadRequestedRef.current) return

    const rect = host.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return

    initialLoadRequestedRef.current = true
    void commitNavigation(currentParams.url)
  }, [commitNavigation])

  useEffect(() => {
    browserReadyRef.current = false
    if (!workspaceId || !params?.sessionMode) return
    window.api.browserCreate(paneId, workspaceId, params.sessionMode).then((result) => {
      if ('error' in result) {
        showToast(result.error)
        initialLoadRequestedRef.current = false
        return
      }
      const currentParams = paramsRef.current
      browserReadyRef.current = true
      void window.api.setBrowserZoom(paneId, currentParams?.zoomFactor ?? 1)
      lastHostUpdateRef.current = ''
      pushHostUpdate()
      requestInitialLoad()
    })
    return () => {
      browserReadyRef.current = false
    }
  }, [paneId, params?.sessionMode, pushHostUpdate, requestInitialLoad, workspaceId])

  useEffect(() => {
    if (!browserReadyRef.current) return
    const nextZoom = params?.zoomFactor ?? 1
    void window.api.setBrowserZoom(paneId, nextZoom)
    setZoomFactor(nextZoom)
  }, [paneId, params?.zoomFactor])

  useEffect(() => {
    const unsubNavigate = window.api.onBrowserDidNavigate((payload: BrowserDidNavigatePayload) => {
      if (payload.paneId !== paneId) return
      setCurrentUrl(payload.url)
      setUrlInput(payload.url)
      syncPanelParams(payload.url)
    })

    const unsubTitle = window.api.onBrowserTitleUpdated((payload: BrowserPageTitlePayload) => {
      if (payload.paneId !== paneId) return
      setPageTitle(payload.title)
    })

    const unsubLoading = window.api.onBrowserLoadingChanged((payload: BrowserLoadingPayload) => {
      if (payload.paneId !== paneId) return
      setLoading(payload.loading)
    })

    const unsubCanNavigate = window.api.onBrowserCanNavigateChanged((payload: BrowserCanNavigatePayload) => {
      if (payload.paneId !== paneId) return
      setCanGoBack(payload.canGoBack)
      setCanGoForward(payload.canGoForward)
    })

    return () => {
      unsubNavigate()
      unsubTitle()
      unsubLoading()
      unsubCanNavigate()
    }
  }, [paneId, syncPanelParams])

  useEffect(() => {
    api.setTitle(pageTitle || titleForUrl(currentUrl))
  }, [api, currentUrl, pageTitle])

  useEffect(() => {
    pushHostUpdate()

    const host = hostRef.current
    if (!host) return

    const observer = new ResizeObserver(() => pushHostUpdate())
    observer.observe(host)
    if (chromeRef.current) observer.observe(chromeRef.current)

    const onResize = () => pushHostUpdate()
    const onLayoutChange = () => {
      pushHostUpdate()
      requestInitialLoad()
    }
    window.addEventListener('resize', onResize)
    const layoutDisposable = containerApi.onDidLayoutChange(onLayoutChange)
    const activeDisposable = api.onDidActiveChange(() => {
      pushHostUpdate()
      requestInitialLoad()
    })
    const visibilityDisposable = api.onDidVisibilityChange(() => {
      pushHostUpdate()
      requestInitialLoad()
    })
    const dimensionsDisposable = api.onDidDimensionsChange(() => {
      pushHostUpdate()
      requestInitialLoad()
    })

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', onResize)
      layoutDisposable.dispose()
      activeDisposable.dispose()
      visibilityDisposable.dispose()
      dimensionsDisposable.dispose()
      window.api.browserHostUpdate({
        paneId,
        workspaceId,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        visible: false,
        chromeHeight: 0,
      })
    }
  }, [api, containerApi, paneId, pushHostUpdate, requestInitialLoad, workspaceId])

  useEffect(() => {
    if (!params?.hasLoadedOnce) {
      initialLoadRequestedRef.current = false
    }
    requestInitialLoad()
  }, [params?.hasLoadedOnce, params?.url, requestInitialLoad])

  useEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      pushHostUpdate()
      requestInitialLoad()
    })
    return () => window.cancelAnimationFrame(rafId)
  }, [pushHostUpdate, requestInitialLoad])

  return (
    <div className="browser-pane">
      <div ref={chromeRef} className="browser-pane__chrome">
        <button
          className="browser-pane__nav-btn"
          type="button"
          onClick={() => window.api.browserGoBack(paneId)}
          disabled={!canGoBack}
          aria-label="Back"
        >
          ‹
        </button>
        <button
          className="browser-pane__nav-btn"
          type="button"
          onClick={() => window.api.browserGoForward(paneId)}
          disabled={!canGoForward}
          aria-label="Forward"
        >
          ›
        </button>
        <button
          className="browser-pane__nav-btn"
          type="button"
          onClick={() => window.api.browserReload(paneId)}
          aria-label="Reload"
        >
          ↻
        </button>
        <form
          className="browser-pane__url-form"
          onSubmit={(event) => {
            event.preventDefault()
            void commitNavigation(urlInput)
          }}
        >
          <input
            className="browser-pane__url-input"
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            spellCheck={false}
            placeholder="Enter URL"
          />
        </form>
        <div className="browser-pane__zoom">
          <button
            className="browser-pane__nav-btn"
            type="button"
            onClick={() => void updateZoomFactor(adjustZoomFactor(zoomFactor, -0.1))}
            aria-label="Zoom out page"
          >
            -
          </button>
          <button
            className="browser-pane__zoom-readout"
            type="button"
            onClick={() => void updateZoomFactor(resetZoomFactor())}
            title="Reset page zoom"
          >
            {zoomFactorToPercent(zoomFactor)}%
          </button>
          <button
            className="browser-pane__nav-btn"
            type="button"
            onClick={() => void updateZoomFactor(adjustZoomFactor(zoomFactor, 0.1))}
            aria-label="Zoom in page"
          >
            +
          </button>
        </div>
        <div className={`browser-pane__status${loading ? ' browser-pane__status--loading' : ''}`}>
          {loading ? 'Loading' : pageTitle || titleForUrl(currentUrl)}
        </div>
      </div>
      <div ref={hostRef} className="browser-pane__host" />
    </div>
  )
}
