/**
 * LLM client types — provider-agnostic canonical format and provider wire types.
 *
 * The canonical types (LlmMessage, LlmContentBlock, LlmStreamEvent, etc.) are
 * the internal format used throughout the agent system. Provider adapters
 * transform to/from their specific wire formats.
 */

// ─── Canonical Message Format ───────────────────────────────────────

export type LlmContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }

export interface LlmMessage {
  role: 'user' | 'assistant'
  content: LlmContentBlock[]
}

export interface LlmToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
}

// ─── Stream Events (provider-agnostic, what consumers receive) ──────

export type LlmStreamEvent =
  | { type: 'message_start'; messageId: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; partialJson: string }
  | { type: 'tool_use_end'; id: string }
  | { type: 'message_end'; stopReason: string; usage: LlmUsage }
  | { type: 'error'; error: string }

// ─── Stream Parameters ──────────────────────────────────────────────

export interface StreamParams {
  requestId: string
  system?: string
  messages: LlmMessage[]
  tools?: LlmToolDefinition[]
  maxTokens?: number
  model?: string
}

// ─── Provider Interface ─────────────────────────────────────────────

export interface LlmProvider {
  stream(
    params: StreamParams,
    config: { apiKey: string; baseUrl?: string; model: string; maxTokens: number },
    signal: AbortSignal,
  ): AsyncGenerator<LlmStreamEvent>
}

// ─── SSE Parser Types ───────────────────────────────────────────────

export interface SseEvent {
  event?: string
  data: string
}

// ─── Anthropic Wire Types ───────────────────────────────────────────

export interface AnthropicRequest {
  model: string
  max_tokens: number
  system?: string
  messages: AnthropicMessage[]
  tools?: AnthropicTool[]
  stream: true
}

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

export interface AnthropicTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export type AnthropicStreamEvent =
  | { type: 'message_start'; message: { id: string; model: string; role: string; content: unknown[]; stop_reason: string | null; usage: { input_tokens: number; output_tokens: number } } }
  | { type: 'content_block_start'; index: number; content_block: { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } }
  | { type: 'content_block_delta'; index: number; delta: { type: 'text_delta'; text: string } | { type: 'input_json_delta'; partial_json: string } }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: string }; usage: { output_tokens: number } }
  | { type: 'message_stop' }
  | { type: 'error'; error: { type: string; message: string } }
  | { type: 'ping' }

// ─── OpenAI Wire Types ──────────────────────────────────────────────

export interface OpenAiRequest {
  model: string
  max_tokens: number
  messages: OpenAiMessage[]
  tools?: OpenAiTool[]
  stream: true
  stream_options?: { include_usage: boolean }
}

export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: OpenAiToolCall[]
  tool_call_id?: string
}

export interface OpenAiToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface OpenAiTool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface OpenAiStreamChunk {
  id: string
  choices: [{
    index: number
    delta: {
      role?: string
      content?: string | null
      tool_calls?: OpenAiStreamToolCall[]
    }
    finish_reason: string | null
  }]
  usage?: { prompt_tokens: number; completion_tokens: number }
}

export interface OpenAiStreamToolCall {
  index: number
  id?: string
  function: { name?: string; arguments: string }
}
