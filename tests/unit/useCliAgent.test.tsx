import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useCliAgent } from '@renderer/hooks/useCliAgent'
import type { CliAgentMessage } from '@aide/shared'

function stubWindowApi(overrides: Record<string, unknown> = {}) {
  const api = {
    cliAgentGetSession: vi.fn().mockResolvedValue(null),
    cliAgentLoadMessages: vi.fn().mockResolvedValue([] as CliAgentMessage[]),
    cliAgentStart: vi.fn().mockResolvedValue({ sessionId: 'started-session' }),
    cliAgentSend: vi.fn().mockResolvedValue({ success: true as const }),
    cliAgentStop: vi.fn(),
    cliAgentSwitchBackend: vi.fn().mockResolvedValue({ success: true as const }),
    cliAgentUpdateSessionConfig: vi.fn().mockResolvedValue({ success: true as const }),
    conversationGet: vi.fn().mockResolvedValue(null),
    onConversationListChanged: vi.fn().mockReturnValue(() => {}),
    onCliAgentStreamDelta: vi.fn().mockReturnValue(() => {}),
    onCliAgentMessage: vi.fn().mockReturnValue(() => {}),
    onCliAgentStatus: vi.fn().mockReturnValue(() => {}),
    onCliAgentResult: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  }
  Object.defineProperty(window, 'api', { value: api, writable: true, configurable: true })
  return api
}

describe('useCliAgent', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'api')
  })

  it('does not call workspace-scoped cliAgentGetSession when conversationId is absent', async () => {
    const api = stubWindowApi()

    renderHook(() => useCliAgent({ workspaceId: 'ws-1' }))

    await waitFor(() => {
      expect(api.cliAgentGetSession).not.toHaveBeenCalled()
    })
  })

  it('hydrates each conversation with getSession by explicit id only', async () => {
    const msgA: CliAgentMessage = {
      id: 'm-a',
      type: 'user',
      content: 'tab a',
      timestamp: 1,
    }
    const msgB: CliAgentMessage = {
      id: 'm-b',
      type: 'user',
      content: 'tab b',
      timestamp: 2,
    }

    const api = stubWindowApi({
      cliAgentGetSession: vi.fn(async (_ws: string, sid?: string) => {
        if (sid === 'conv-a') {
          return {
            id: 'conv-a',
            workspaceId: 'ws-1',
            backend: 'claude-code',
            processStatus: 'stopped',
            messages: [msgA],
            model: null,
            sessionToolNames: undefined,
            lastError: undefined,
            totalCostUsd: 0,
          }
        }
        if (sid === 'conv-b') {
          return {
            id: 'conv-b',
            workspaceId: 'ws-1',
            backend: 'claude-code',
            processStatus: 'stopped',
            messages: [msgB],
            model: null,
            sessionToolNames: undefined,
            lastError: undefined,
            totalCostUsd: 0,
          }
        }
        return null
      }),
    })

    const { result: a } = renderHook(() =>
      useCliAgent({ workspaceId: 'ws-1', conversationId: 'conv-a' }),
    )
    const { result: b } = renderHook(() =>
      useCliAgent({ workspaceId: 'ws-1', conversationId: 'conv-b' }),
    )

    await waitFor(() => {
      expect(a.current.historyHydrated).toBe(true)
      expect(b.current.historyHydrated).toBe(true)
    })

    expect(api.cliAgentGetSession).toHaveBeenCalledWith('ws-1', 'conv-a')
    expect(api.cliAgentGetSession).toHaveBeenCalledWith('ws-1', 'conv-b')
    expect(a.current.messages.map((m) => m.content)).toEqual(['tab a'])
    expect(b.current.messages.map((m) => m.content)).toEqual(['tab b'])

    const workspaceOnlyCalls = (api.cliAgentGetSession as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[1] === undefined,
    )
    expect(workspaceOnlyCalls).toHaveLength(0)
  })

  it('after start(), uses result.sessionId for follow-up getSession', async () => {
    const api = stubWindowApi({
      cliAgentStart: vi.fn().mockResolvedValue({ sessionId: 'new-sid' }),
      cliAgentGetSession: vi.fn(async () => ({
        id: 'new-sid',
        workspaceId: 'ws-1',
        backend: 'claude-code',
        processStatus: 'stopped',
        messages: [],
        model: null,
        totalCostUsd: 0,
      })),
    })

    const { result } = renderHook(() =>
      useCliAgent({ workspaceId: 'ws-1', conversationId: 'provisional-id' }),
    )

    await waitFor(() => expect(result.current.historyHydrated).toBe(true))

    await act(async () => {
      await result.current.start('claude-code')
    })

    expect(api.cliAgentGetSession).toHaveBeenCalledWith('ws-1', 'new-sid')
  })
})
