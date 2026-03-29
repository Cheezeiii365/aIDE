import { describe, it, expect } from 'vitest'
import { parseSseStream } from '@main/providers/sseParser'

/** Helper: create a ReadableStream from an array of string chunks. */
function createStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]))
      } else {
        controller.close()
      }
    },
  })
}

/** Collect all events from the async generator. */
async function collectEvents(stream: ReadableStream<Uint8Array>) {
  const events = []
  for await (const event of parseSseStream(stream)) {
    events.push(event)
  }
  return events
}

describe('parseSseStream', () => {
  it('parses a single complete SSE event', async () => {
    const stream = createStream(['data: {"type":"ping"}\n\n'])
    const events = await collectEvents(stream)
    expect(events).toEqual([{ event: undefined, data: '{"type":"ping"}' }])
  })

  it('parses multiple events in one chunk', async () => {
    const stream = createStream([
      'data: {"a":1}\n\ndata: {"b":2}\n\n',
    ])
    const events = await collectEvents(stream)
    expect(events).toHaveLength(2)
    expect(events[0].data).toBe('{"a":1}')
    expect(events[1].data).toBe('{"b":2}')
  })

  it('handles events split across chunk boundaries', async () => {
    const stream = createStream([
      'data: {"par',
      'tial":true}\n\n',
    ])
    const events = await collectEvents(stream)
    expect(events).toHaveLength(1)
    expect(events[0].data).toBe('{"partial":true}')
  })

  it('captures event: field as metadata', async () => {
    const stream = createStream([
      'event: message_start\ndata: {"type":"message_start"}\n\n',
    ])
    const events = await collectEvents(stream)
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('message_start')
    expect(events[0].data).toBe('{"type":"message_start"}')
  })

  it('skips [DONE] sentinel', async () => {
    const stream = createStream([
      'data: {"a":1}\n\ndata: [DONE]\n\n',
    ])
    const events = await collectEvents(stream)
    expect(events).toHaveLength(1)
    expect(events[0].data).toBe('{"a":1}')
  })

  it('handles \\r\\n line endings', async () => {
    const stream = createStream([
      'data: {"a":1}\r\n\r\n',
    ])
    const events = await collectEvents(stream)
    expect(events).toHaveLength(1)
    expect(events[0].data).toBe('{"a":1}')
  })

  it('ignores empty data between events', async () => {
    const stream = createStream([
      '\n\ndata: {"a":1}\n\n\n\n',
    ])
    const events = await collectEvents(stream)
    expect(events).toHaveLength(1)
  })

  it('handles data: with no space after colon', async () => {
    const stream = createStream([
      'data:{"compact":true}\n\n',
    ])
    const events = await collectEvents(stream)
    expect(events).toHaveLength(1)
    expect(events[0].data).toBe('{"compact":true}')
  })

  it('flushes buffered data at end of stream', async () => {
    // Stream ends without final newline pair
    const stream = createStream([
      'data: {"final":true}',
    ])
    const events = await collectEvents(stream)
    expect(events).toHaveLength(1)
    expect(events[0].data).toBe('{"final":true}')
  })

  it('handles many small chunks', async () => {
    const full = 'event: test\ndata: {"ok":true}\n\n'
    const chunks = full.split('').map((c) => c) // one char per chunk
    const stream = createStream(chunks)
    const events = await collectEvents(stream)
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('test')
    expect(events[0].data).toBe('{"ok":true}')
  })

  it('returns empty array for empty stream', async () => {
    const stream = createStream([])
    const events = await collectEvents(stream)
    expect(events).toHaveLength(0)
  })
})
