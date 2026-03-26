import { describe, expect, it } from 'vitest'
import { createBrowserPanelParams, serializeBrowserPaneState } from '@renderer/lib/browserState'

describe('browserState', () => {
  it('creates browser panel params with a default zoom factor', () => {
    const params = createBrowserPanelParams('ws-1', 'workspace', 'https://example.com')
    expect(params.zoomFactor).toBe(1)
    expect(params.hasLoadedOnce).toBe(false)
  })

  it('serializes browser pane zoom factors into workspace state', () => {
    const dockviewApi = {
      panels: [
        {
          params: {
            paneId: 'browser-1',
            workspaceId: 'ws-1',
            sessionMode: 'workspace',
            url: 'https://example.com',
            hasLoadedOnce: true,
            zoomFactor: 1.3,
          },
        },
      ],
    } as never

    expect(serializeBrowserPaneState(dockviewApi, 'ws-1')).toEqual([
      {
        paneId: 'browser-1',
        workspaceId: 'ws-1',
        sessionMode: 'workspace',
        url: 'https://example.com',
        hasLoadedOnce: true,
        zoomFactor: 1.3,
      },
    ])
  })
})
