import { useCallback, useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { showToast } from '../Toast'
import type { BrowserCanNavigatePayload, BrowserDidNavigatePayload, BrowserLoadingPayload, BrowserPageTitlePayload } from '@aide/shared'
import type { BrowserPanelParams } from '../../lib/browserState'
import '../../styles/browser-pane.css'

function titleForUrl(url: string): string {
  if (!url) return 'Browser'
  try {
    return new URL(url).hostname || 'Browser'
  } catch {
    return url
  }
}

function isAbortError(message: string): boolean {
  return /ERR_ABORTED/i.test(message)
}

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
  }, [api, paneId, workspaceId])

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
  }, [params?.url])

  const requestInitialLoad = useCallback(() => {
    const host = hostRef.current
    const currentParams = paramsRef.current
    if (!browserReadyRef.current || !host || !currentParams?.url || currentParams.hasLoadedOnce || initialLoadRequestedRef.current) return

    const rect = host.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return

    initialLoadRequestedRef.current = true
    void commitNavigation(currentParams.url)
  }, [api, commitNavigation])

  useEffect(() => {
    browserReadyRef.current = false
    if (!workspaceId || !params?.sessionMode) return
    window.api.browserCreate(paneId, workspaceId, params.sessionMode).then((result) => {
      if ('error' in result) {
        showToast(result.error)
        initialLoadRequestedRef.current = false
        return
      }
      browserReadyRef.current = true
      lastHostUpdateRef.current = ''
      pushHostUpdate()
      requestInitialLoad()
    })
    return () => {
      browserReadyRef.current = false
    }
  }, [paneId, params?.sessionMode, pushHostUpdate, requestInitialLoad, workspaceId])

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
        <div className={`browser-pane__status${loading ? ' browser-pane__status--loading' : ''}`}>
          {loading ? 'Loading' : pageTitle || titleForUrl(currentUrl)}
        </div>
      </div>
      <div ref={hostRef} className="browser-pane__host" />
    </div>
  )
}
