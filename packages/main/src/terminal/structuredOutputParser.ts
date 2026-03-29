/**
 * Structured output parser for CLI agents.
 *
 * Parses newline-delimited JSON (NDJSON) from stdout of CLI agents like
 * Claude Code (`--output-format stream-json`). Buffers partial lines across
 * chunk boundaries and emits parsed events.
 */

import { EventEmitter } from 'events'

export interface ParsedEvent {
  type: string
  subtype?: string
  [key: string]: unknown
}

export interface StructuredOutputParserEvents {
  event: [ParsedEvent]
  error: [Error]
}

export class StructuredOutputParser extends EventEmitter {
  private buffer = ''

  /**
   * Feed a raw stdout chunk. Complete JSON lines are parsed and emitted
   * as `'event'`. Incomplete trailing data is buffered for the next call.
   */
  feed(chunk: string): void {
    this.buffer += chunk
    const lines = this.buffer.split('\n')

    // Keep the last element — it's either '' (complete line) or a partial
    this.buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      try {
        const parsed = JSON.parse(trimmed) as ParsedEvent
        this.emit('event', parsed)
      } catch (err) {
        this.emit('error', new Error(`Failed to parse JSON line: ${trimmed.slice(0, 200)}`))
      }
    }
  }

  /** Flush any remaining buffered data (call on process exit). */
  flush(): void {
    const trimmed = this.buffer.trim()
    this.buffer = ''
    if (!trimmed) return

    try {
      const parsed = JSON.parse(trimmed) as ParsedEvent
      this.emit('event', parsed)
    } catch {
      // Final partial line — nothing useful to emit
    }
  }
}
