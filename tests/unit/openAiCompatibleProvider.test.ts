import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenAiCompatibleProvider, toOpenAiMessages, toOpenAiTools } from '@main/providers/openAiCompatibleProvider'
import type { LlmMessage, LlmToolDefinition, LlmStreamEvent } from '@shared/index'

// ─── Helpers ────────────────────────────────────────────────────────

function createMockSSEResponse(events: string[], status = 200): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event))
      }
      controller.close()
    },
  })
  return new Response(body, { status, statusText: status === 200 ? 'OK' : 'Error' })
}

async function collectEvents(gen: AsyncGenerator<LlmStreamEvent>): Promise<LlmStreamEvent[]> {
  const events: LlmStreamEvent[] = []
  for await (const e of gen) events.push(e)
  return events
}

const defaultConfig = {
  apiKey: 'test-key',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  maxTokens: 4096,
}

// ─── Format Transformation Tests ────────────────────────────────────

describe('toOpenAiMessages', () => {
  it('adds system prompt as first message', () => {
    const messages: LlmMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
    ]
    const result = toOpenAiMessages(messages, 'You are helpful.')
    expect(result[0]).toEqual({ role: 'system', content: 'You are helpful.' })
    expect(result[1]).toEqual({ role: 'user', content: 'Hello' })
  })

  it('converts user text blocks', () => {
    const messages: LlmMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'Hello' }, { type: 'text', text: 'World' }] },
    ]
    const result = toOpenAiMessages(messages)
    expect(result[0]).toEqual({ role: 'user', content: 'Hello\nWorld' })
  })

  it('converts tool_use blocks to tool_calls on assistant message', () => {
    const messages: LlmMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me read that.' },
          { type: 'tool_use', id: 'tc-1', name: 'file_read', input: { path: '/foo.ts' } },
        ],
      },
    ]
    const result = toOpenAiMessages(messages)
    expect(result[0]).toEqual({
      role: 'assistant',
      content: 'Let me read that.',
      tool_calls: [{
        id: 'tc-1',
        type: 'function',
        function: { name: 'file_read', arguments: '{"path":"/foo.ts"}' },
      }],
    })
  })

  it('converts tool_result blocks to tool messages', () => {
    const messages: LlmMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'tool_result', toolUseId: 'tc-1', content: 'file contents' },
          { type: 'text', text: 'What does this do?' },
        ],
      },
    ]
    const result = toOpenAiMessages(messages)
    expect(result[0]).toEqual({ role: 'tool', content: 'file contents', tool_call_id: 'tc-1' })
    expect(result[1]).toEqual({ role: 'user', content: 'What does this do?' })
  })

  it('sets content to null when assistant has only tool_calls', () => {
    const messages: LlmMessage[] = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tc-1', name: 'file_read', input: {} }],
      },
    ]
    const result = toOpenAiMessages(messages)
    expect(result[0].content).toBeNull()
  })
})

describe('toOpenAiTools', () => {
  it('converts tool definitions to function format', () => {
    const tools: LlmToolDefinition[] = [
      { name: 'file_read', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    ]
    const result = toOpenAiTools(tools)
    expect(result).toEqual([{
      type: 'function',
      function: {
        name: 'file_read',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
    }])
  })
})

// ─── Streaming Tests ────────────────────────────────────────────────

describe('OpenAiCompatibleProvider', () => {
  const provider = new OpenAiCompatibleProvider()
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('streams a text response', async () => {
    fetchSpy.mockResolvedValue(createMockSSEResponse([
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
      'data: [DONE]\n\n',
    ]))

    const events = await collectEvents(
      provider.stream(
        { requestId: 'r-1', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] },
        defaultConfig,
        new AbortController().signal,
      ),
    )

    expect(events[0]).toEqual({ type: 'message_start', messageId: 'chatcmpl-1' })
    expect(events[1]).toEqual({ type: 'text_delta', text: 'Hello' })
    expect(events[2]).toEqual({ type: 'text_delta', text: ' world' })
    expect(events[3]).toEqual({ type: 'message_end', stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5 } })
  })

  it('streams tool call response', async () => {
    fetchSpy.mockResolvedValue(createMockSSEResponse([
      'data: {"id":"chatcmpl-2","choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call-1","function":{"name":"file_read","arguments":""}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-2","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\""}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-2","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"/foo.ts\\"}"}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-2","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":15,"completion_tokens":10}}\n\n',
      'data: [DONE]\n\n',
    ]))

    const events = await collectEvents(
      provider.stream(
        { requestId: 'r-2', messages: [{ role: 'user', content: [{ type: 'text', text: 'Read file' }] }] },
        defaultConfig,
        new AbortController().signal,
      ),
    )

    expect(events[0]).toEqual({ type: 'message_start', messageId: 'chatcmpl-2' })
    expect(events[1]).toEqual({ type: 'tool_use_start', id: 'call-1', name: 'file_read' })
    expect(events[2]).toEqual({ type: 'tool_use_delta', id: 'call-1', partialJson: '{"path"' })
    expect(events[3]).toEqual({ type: 'tool_use_delta', id: 'call-1', partialJson: ':"/foo.ts"}' })
    expect(events[4]).toEqual({ type: 'tool_use_end', id: 'call-1' })
    expect(events[5]).toEqual({ type: 'message_end', stopReason: 'tool_use', usage: { inputTokens: 15, outputTokens: 10 } })
  })

  it('maps finish_reason correctly', async () => {
    const testCases = [
      { reason: 'stop', expected: 'end_turn' },
      { reason: 'length', expected: 'max_tokens' },
      { reason: 'tool_calls', expected: 'tool_use' },
    ]

    for (const { reason, expected } of testCases) {
      fetchSpy.mockResolvedValue(createMockSSEResponse([
        `data: {"id":"chatcmpl-x","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n`,
        `data: {"id":"chatcmpl-x","choices":[{"index":0,"delta":{},"finish_reason":"${reason}"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n`,
        'data: [DONE]\n\n',
      ]))

      const events = await collectEvents(
        provider.stream(
          { requestId: `r-${reason}`, messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] },
          defaultConfig,
          new AbortController().signal,
        ),
      )

      const endEvent = events.find((e) => e.type === 'message_end')
      expect(endEvent).toBeDefined()
      expect((endEvent as { type: 'message_end'; stopReason: string }).stopReason).toBe(expected)
    }
  })

  it('yields error when baseUrl is missing', async () => {
    const events = await collectEvents(
      provider.stream(
        { requestId: 'r-no-url', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] },
        { apiKey: 'test', model: 'gpt-4o', maxTokens: 4096 },
        new AbortController().signal,
      ),
    )

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('error')
    expect((events[0] as { type: 'error'; error: string }).error).toContain('baseUrl')
  })

  it('yields error on HTTP error', async () => {
    fetchSpy.mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 }))

    const events = await collectEvents(
      provider.stream(
        { requestId: 'r-401', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] },
        defaultConfig,
        new AbortController().signal,
      ),
    )

    expect(events).toHaveLength(1)
    expect((events[0] as { type: 'error'; error: string }).error).toContain('401')
  })

  it('yields error on network failure', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'))

    const events = await collectEvents(
      provider.stream(
        { requestId: 'r-net', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] },
        defaultConfig,
        new AbortController().signal,
      ),
    )

    expect(events).toHaveLength(1)
    expect((events[0] as { type: 'error'; error: string }).error).toContain('Network error')
  })

  it('sends correct headers and URL', async () => {
    fetchSpy.mockResolvedValue(createMockSSEResponse([
      'data: {"id":"x","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
      'data: [DONE]\n\n',
    ]))

    await collectEvents(
      provider.stream(
        { requestId: 'r-h', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] },
        defaultConfig,
        new AbortController().signal,
      ),
    )

    const [url, opts] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(opts.headers['authorization']).toBe('Bearer test-key')
    expect(opts.headers['content-type']).toBe('application/json')
  })

  it('returns cleanly on abort', async () => {
    const abortError = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    fetchSpy.mockRejectedValue(abortError)

    const events = await collectEvents(
      provider.stream(
        { requestId: 'r-abort', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] },
        defaultConfig,
        new AbortController().signal,
      ),
    )

    expect(events).toHaveLength(0)
  })
})
