/**
 * Shared SSE (Server-Sent Events) stream parser.
 *
 * Parses a ReadableStream of bytes into structured SSE events.
 * Handles chunk boundary buffering — SSE events may span multiple chunks.
 */

import type { SseEvent } from '@aide/shared'

/**
 * Parse an SSE stream into structured events.
 *
 * Yields one {@link SseEvent} per SSE data payload. Handles:
 * - Chunk boundaries (partial lines buffered across reads)
 * - `event:` fields (returned as `event` property)
 * - `data:` fields (returned as `data` property)
 * - Multi-line data fields (concatenated with newlines)
 * - Empty lines as event delimiters
 * - `[DONE]` sentinel (skipped, signals end of stream)
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let currentEvent: string | undefined
  let currentData: string[] = []

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      // Last element may be incomplete — keep it in the buffer
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line === '' || line === '\r') {
          // Empty line = event delimiter
          if (currentData.length > 0) {
            const data = currentData.join('\n')
            if (data !== '[DONE]') {
              yield { event: currentEvent, data }
            }
            currentEvent = undefined
            currentData = []
          }
          continue
        }

        const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line

        if (trimmed.startsWith('data: ')) {
          currentData.push(trimmed.slice(6))
        } else if (trimmed.startsWith('data:')) {
          currentData.push(trimmed.slice(5))
        } else if (trimmed.startsWith('event: ')) {
          currentEvent = trimmed.slice(7)
        } else if (trimmed.startsWith('event:')) {
          currentEvent = trimmed.slice(6)
        }
        // Ignore id:, retry:, and comment lines (starting with :)
      }
    }

    // Flush any trailing bytes the streaming decoder may have buffered
    buffer += decoder.decode()

    // Flush any remaining buffered data
    if (buffer.length > 0) {
      const lines = buffer.split('\n')
      for (const line of lines) {
        const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line
        if (trimmed.startsWith('data: ')) {
          currentData.push(trimmed.slice(6))
        } else if (trimmed.startsWith('data:')) {
          currentData.push(trimmed.slice(5))
        }
      }
    }
    if (currentData.length > 0) {
      const data = currentData.join('\n')
      if (data !== '[DONE]') {
        yield { event: currentEvent, data }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
