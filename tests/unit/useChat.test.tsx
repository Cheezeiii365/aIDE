import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, renderHook, waitFor } from '@testing-library/react'
import type { ChatMessage, ChatSession } from '@aide/shared'
import { useChat } from '@renderer/hooks/useChat'
import { ChatPane } from '@renderer/components/panes/ChatPane'

function stubWindowApi(overrides: Record<string, unknown> = {}) {
  const api = {
    chatGetHistory: vi.fn().mockResolvedValue(null),
    chatSendMessage: vi.fn().mockResolvedValue({ messageId: 'msg-1' }),
    chatSetMode: vi.fn().mockResolvedValue(undefined),
    chatSetWorkingSet: vi.fn().mockResolvedValue(undefined),
    chatToolApprove: vi.fn().mockResolvedValue(undefined),
    chatToolReject: vi.fn().mockResolvedValue(undefined),
    chatStop: vi.fn(),
    conversationGet: vi.fn().mockResolvedValue(null),
    getResolvedSettings: vi.fn().mockResolvedValue({}),
    onSettingsChanged: vi.fn().mockReturnValue(() => {}),
    onConversationListChanged: vi.fn().mockReturnValue(() => {}),
    onChatStreamChunk: vi.fn().mockReturnValue(() => {}),
    onChatStreamEnd: vi.fn().mockReturnValue(() => {}),
    onChatToolCall: vi.fn().mockReturnValue(() => {}),
    listAllFiles: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
  Object.defineProperty(window, 'api', { value: api, writable: true, configurable: true })
  return api
}

function makeSession(id: string, content: string): ChatSession {
  const message: ChatMessage = {
    id: `msg-${id}`,
    role: 'user',
    content,
    timestamp: 1,
  }

  return {
    id,
    workspaceId: 'ws-1',
    mode: 'agent',
    messages: [message],
    workingSet: [],
    status: 'idle',
  }
}

describe('useChat', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'api')
  })

  it('hydrates each conversation by explicit id', async () => {
    const api = stubWindowApi({
      chatGetHistory: vi.fn(async (_workspaceId: string, conversationId?: string) => {
        if (conversationId === 'conv-a') return makeSession('conv-a', 'tab a')
        if (conversationId === 'conv-b') return makeSession('conv-b', 'tab b')
        return null
      }),
    })

    const { result: a } = renderHook(() => useChat('ws-1', 'conv-a'))
    const { result: b } = renderHook(() => useChat('ws-1', 'conv-b'))

    await waitFor(() => {
      expect(a.current.sessionId).toBe('conv-a')
      expect(b.current.sessionId).toBe('conv-b')
    })

    expect(api.chatGetHistory).toHaveBeenCalledWith('ws-1', 'conv-a')
    expect(api.chatGetHistory).toHaveBeenCalledWith('ws-1', 'conv-b')
    expect(a.current.messages.map((m) => m.content)).toEqual(['tab a'])
    expect(b.current.messages.map((m) => m.content)).toEqual(['tab b'])
  })

  it('writes the resolved session id back into chat pane params', async () => {
    stubWindowApi({
      chatGetHistory: vi.fn().mockResolvedValue(makeSession('conv-restored', 'restored chat')),
    })

    const panelApi = {
      updateParameters: vi.fn(),
      setTitle: vi.fn(),
    }

    render(
      <ChatPane
        params={{ workspaceId: 'ws-1', workspaceRoot: '/tmp/project' }}
        api={panelApi as never}
      />,
    )

    await waitFor(() => {
      expect(panelApi.updateParameters).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        workspaceRoot: '/tmp/project',
        conversationId: 'conv-restored',
      })
    })
  })
})
