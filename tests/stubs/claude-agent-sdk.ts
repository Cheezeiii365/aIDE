export interface ClaudeAgentSdkMessage {
  type: string
  subtype?: string
  [key: string]: unknown
}

export interface Query extends AsyncIterable<ClaudeAgentSdkMessage> {
  close(): void
}

export function query(_params: {
  prompt: string | AsyncIterable<{ role: string; content: string }>
  options?: Record<string, unknown>
}): Query {
  return {
    close() {},
    async *[Symbol.asyncIterator]() {
      return
    },
  }
}
