import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AnthropicProvider, toAnthropicMessages, toAnthropicTools } from '@main/providers/anthropicProvider'
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

const defaultConfig = { apiKey: 'test-key', model: 'claude-sonnet-4-20250514', maxTokens: 4096 }

// ─── Format Transformation Tests ────────────────────────────────────

describe('toAnthropicMessages', () => {
  it('converts text blocks', () => {
    const messages: LlmMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
    ]
    const result = toAnthropicMessages(messages)
    expect(result).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
    ])
  })

  it('converts tool_use blocks', () => {
    const messages: LlmMessage[] = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tc-1', name: 'file_read', input: { path: '/foo.ts' } }],
      },
    ]
    const result = toAnthropicMessages(messages)
    expect(result[0].content).toEqual([
      { type: 'tool_use', id: 'tc-1', name: 'file_read', input: { path: '/foo.ts' } },
    ])
  })

  it('converts tool_result blocks', () => {
    const messages: LlmMessage[] = [
      {
        role: 'user',
        content: [{ type: 'tool_result', toolUseId: 'tc-1', content: 'file contents', isError: false }],
      },
    ]
    const result = toAnthropicMessages(messages)
    expect(result[0].content).toEqual([
      { type: 'tool_result', tool_use_id: 'tc-1', content: 'file contents' },
    ])
  })

  it('includes is_error only when true', () => {
    const messages: LlmMessage[] = [
      {
        role: 'user',
        content: [{ type: 'tool_result', toolUseId: 'tc-1', content: 'error', isError: true }],
      },
    ]
    const result = toAnthropicMessages(messages)
    expect((result[0].content as unknown[])[0]).toHaveProperty('is_error', true)
  })
})

describe('toAnthropicTools', () => {
  it('converts tool definitions', () => {
    const tools: LlmToolDefinition[] = [
      { name: 'file_read', description: 'Read a file', inputSchema: { type: 'object' } },
    ]
    const result = toAnthropicTools(tools)
    expect(result).toEqual([
      { name: 'file_read', description: 'Read a file', input_schema: { type: 'object' } },
    ])
  })
})

// ─── Streaming Tests ────────────────────────────────────────────────

describe('AnthropicProvider', () => {
  const provider = new AnthropicProvider()
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('streams a text-only response', async () => {
    fetchSpy.mockResolvedValue(createMockSSEResponse([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-1","model":"claude","role":"assistant","content":[],"stop_reason":null,"usage":{"input_tokens":10,"output_tokens":1}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]))

    const events = await collectEvents(
      provider.stream(
        { requestId: 'r-1', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] },
        defaultConfig,
        new AbortController().signal,
      ),
    )

    expect(events).toEqual([
      { type: 'message_start', messageId: 'msg-1' },
      { type: 'text_delta', text: 'Hello' },
      { type: 'text_delta', text: ' world' },
      { type: 'message_end', stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5 } },
    ])
  })

  it('streams a tool_use response', async () => {
    fetchSpy.mockResolvedValue(createMockSSEResponse([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-2","model":"claude","role":"assistant","content":[],"stop_reason":null,"usage":{"input_tokens":20,"output_tokens":1}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu-1","name":"file_read","input":{}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":": \\"/foo.ts\\"}"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":15}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]))

    const events = await collectEvents(
      provider.stream(
        { requestId: 'r-2', messages: [{ role: 'user', content: [{ type: 'text', text: 'Read file' }] }] },
        defaultConfig,
        new AbortController().signal,
      ),
    )

    expect(events[0]).toEqual({ type: 'message_start', messageId: 'msg-2' })
    expect(events[1]).toEqual({ type: 'tool_use_start', id: 'tu-1', name: 'file_read' })
    expect(events[2]).toEqual({ type: 'tool_use_delta', id: 'tu-1', partialJson: '{"path"' })
    expect(events[3]).toEqual({ type: 'tool_use_delta', id: 'tu-1', partialJson: ': "/foo.ts"}' })
    expect(events[4]).toEqual({ type: 'tool_use_end', id: 'tu-1' })
    expect(events[5]).toEqual({ type: 'message_end', stopReason: 'tool_use', usage: { inputTokens: 20, outputTokens: 15 } })
  })

  it('handles ping events silently', async () => {
    fetchSpy.mockResolvedValue(createMockSSEResponse([
      'event: ping\ndata: {"type":"ping"}\n\n',
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-3","model":"claude","role":"assistant","content":[],"stop_reason":null,"usage":{"input_tokens":5,"output_tokens":1}}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]))

    const events = await collectEvents(
      provider.stream(
        { requestId: 'r-3', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] },
        defaultConfig,
        new AbortController().signal,
      ),
    )

    expect(events.find((e) => e.type === 'error')).toBeUndefined()
    expect(events[0]).toEqual({ type: 'message_start', messageId: 'msg-3' })
  })

  it('handles API error events', async () => {
    fetchSpy.mockResolvedValue(createMockSSEResponse([
      'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
    ]))

    const events = await collectEvents(
      provider.stream(
        { requestId: 'r-4', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] },
        defaultConfig,
        new AbortController().signal,
      ),
    )

    expect(events[0]).toEqual({ type: 'error', error: 'overloaded_error: Overloaded' })
  })

  it('yields error on HTTP 401', async () => {
    fetchSpy.mockResolvedValue(new Response('{"error":"invalid_api_key"}', { status: 401 }))

    const events = await collectEvents(
      provider.stream(
        { requestId: 'r-5', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] },
        defaultConfig,
        new AbortController().signal,
      ),
    )

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('error')
    expect((events[0] as { type: 'error'; error: string }).error).toContain('401')
  })

  it('yields error on HTTP 429', async () => {
    fetchSpy.mockResolvedValue(new Response('{"error":"rate_limited"}', { status: 429 }))

    const events = await collectEvents(
      provider.stream(
        { requestId: 'r-6', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] },
        defaultConfig,
        new AbortController().signal,
      ),
    )

    expect(events).toHaveLength(1)
    expect((events[0] as { type: 'error'; error: string }).error).toContain('429')
  })

  it('yields error on network failure', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'))

    const events = await collectEvents(
      provider.stream(
        { requestId: 'r-7', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] },
        defaultConfig,
        new AbortController().signal,
      ),
    )

    expect(events).toHaveLength(1)
    expect((events[0] as { type: 'error'; error: string }).error).toContain('Network error')
  })

  it('sends correct headers and URL', async () => {
    fetchSpy.mockResolvedValue(createMockSSEResponse([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-x","model":"claude","role":"assistant","content":[],"stop_reason":null,"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]))

    await collectEvents(
      provider.stream(
        { requestId: 'r-8', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] },
        defaultConfig,
        new AbortController().signal,
      ),
    )

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, opts] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(opts.headers['x-api-key']).toBe('test-key')
    expect(opts.headers['anthropic-version']).toBe('2023-06-01')
    expect(opts.headers['content-type']).toBe('application/json')
  })

  it('uses custom baseUrl when provided', async () => {
    fetchSpy.mockResolvedValue(createMockSSEResponse([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-x","model":"claude","role":"assistant","content":[],"stop_reason":null,"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
    ]))

    await collectEvents(
      provider.stream(
        { requestId: 'r-9', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] },
        { ...defaultConfig, baseUrl: 'https://custom.api.com' },
        new AbortController().signal,
      ),
    )

    expect(fetchSpy.mock.calls[0][0]).toBe('https://custom.api.com/v1/messages')
  })

  it('includes system prompt and tools in request body', async () => {
    fetchSpy.mockResolvedValue(createMockSSEResponse([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-x","model":"claude","role":"assistant","content":[],"stop_reason":null,"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
    ]))

    await collectEvents(
      provider.stream(
        {
          requestId: 'r-10',
          system: 'You are a helpful assistant.',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
          tools: [{ name: 'file_read', description: 'Read a file', inputSchema: { type: 'object' } }],
        },
        defaultConfig,
        new AbortController().signal,
      ),
    )

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.system).toBe('You are a helpful assistant.')
    expect(body.tools).toEqual([{ name: 'file_read', description: 'Read a file', input_schema: { type: 'object' } }])
    expect(body.stream).toBe(true)
  })

  it('returns cleanly on abort', async () => {
    const controller = new AbortController()
    const abortError = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    fetchSpy.mockRejectedValue(abortError)

    const events = await collectEvents(
      provider.stream(
        { requestId: 'r-11', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] },
        defaultConfig,
        controller.signal,
      ),
    )

    expect(events).toHaveLength(0)
  })
})
