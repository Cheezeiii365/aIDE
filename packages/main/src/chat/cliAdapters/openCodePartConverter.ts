/**
 * OpenCode Part → CliAgentMessage(s) converter.
 *
 * Maps every part `type` discriminant exposed by `@opencode-ai/sdk` onto our
 * normalized `CliAgentMessage` shape. Returns one or more messages per part
 * (e.g. a tool part may emit a single tool_use OR tool_result message
 * depending on its current state).
 *
 * Unknown / unhandled types fall back to a generic `system` message so the
 * renderer can still display them.
 */

import { randomUUID } from 'crypto'
import type { CliAgentMessage, CliAgentTokenUsage } from '@aide/shared'

interface BasePart {
  id?: string
  sessionID?: string
  messageID?: string
  type?: string
  [key: string]: unknown
}

interface ConvertContext {
  /** Optional delta string from the part.updated event (text deltas only). */
  delta?: string
  /** Track which tool partIds we've already emitted in which state. */
  seenToolStates: Map<string, string>
  /** Track which reasoning partIds we've already emitted (to avoid duplicate emit on each delta). */
  seenReasoningIds: Set<string>
}

export function createConvertContext(): ConvertContext {
  return {
    seenToolStates: new Map(),
    seenReasoningIds: new Set(),
  }
}

export interface ConvertedPart {
  /** Messages to emit. May be empty if the part is purely a delta. */
  messages: CliAgentMessage[]
  /** True if this part is a streaming text delta (caller should also emit a stream-delta event). */
  isTextDelta: boolean
  /** Text delta value, present iff isTextDelta. */
  delta?: string
  /** The messageId for the text accumulator. */
  messageId?: string
}

/**
 * Convert a single OpenCode `part` event payload into normalized messages.
 *
 * The `delta` argument comes from `props.delta` on `message.part.updated`.
 */
export function convertOpenCodePart(
  rawPart: unknown,
  rawDelta: string | undefined,
  ctx: ConvertContext,
): ConvertedPart {
  const part = (rawPart ?? {}) as BasePart
  const partType = typeof part.type === 'string' ? part.type : ''
  const partId = (typeof part.id === 'string' ? part.id : null) ?? randomUUID()
  const messageId = typeof part.messageID === 'string' ? part.messageID : undefined
  const now = Date.now()

  switch (partType) {
    case 'text': {
      const text = stringField(part, 'text') ?? ''
      const synthetic = part.synthetic === true
      const ignored = part.ignored === true
      if (ignored) return { messages: [], isTextDelta: false }
      if (rawDelta) {
        return {
          messages: [],
          isTextDelta: true,
          delta: rawDelta,
          messageId: messageId ?? partId,
        }
      }
      // Final / complete text part — emit as assistant message.
      return {
        messages: [
          {
            id: messageId ?? partId,
            type: synthetic ? 'system' : 'assistant',
            content: text,
            timestamp: now,
            raw: part,
          },
        ],
        isTextDelta: false,
      }
    }

    case 'reasoning': {
      // Stream reasoning text incrementally; first occurrence creates the
      // message, subsequent updates patch it. We emit one message at the end
      // (when text is non-empty) for simplicity.
      const text = stringField(part, 'text') ?? ''
      if (!text || ctx.seenReasoningIds.has(partId)) {
        return { messages: [], isTextDelta: false }
      }
      ctx.seenReasoningIds.add(partId)
      return {
        messages: [
          {
            id: partId,
            type: 'reasoning',
            content: text,
            timestamp: now,
            reasoningCollapsed: true,
            raw: part,
          },
        ],
        isTextDelta: false,
      }
    }

    case 'file': {
      const mime = stringField(part, 'mime') ?? 'application/octet-stream'
      const url = stringField(part, 'url') ?? ''
      const filename = stringField(part, 'filename')
      return {
        messages: [
          {
            id: partId,
            type: 'file_attachment',
            content: filename ?? url,
            timestamp: now,
            fileMime: mime,
            fileUrl: url,
            fileName: filename,
            raw: part,
          },
        ],
        isTextDelta: false,
      }
    }

    case 'tool': {
      const state = (part.state ?? {}) as Record<string, unknown>
      const status = stringField(state, 'status') ?? 'pending'
      const priorStatus = ctx.seenToolStates.get(partId)
      if (priorStatus === status) {
        return { messages: [], isTextDelta: false }
      }
      ctx.seenToolStates.set(partId, status)

      const toolName = stringField(part, 'tool') ?? 'tool'
      const toolUseId = stringField(part, 'callID')

      if (status === 'pending' || status === 'running') {
        return {
          messages: [
            {
              id: partId,
              type: 'tool_use',
              content: `Running ${toolName}...`,
              timestamp: now,
              toolName,
              toolUseId,
              raw: part,
            },
          ],
          isTextDelta: false,
        }
      }
      if (status === 'completed') {
        const output =
          stringField(state, 'output') ?? stringField(state, 'title') ?? `${toolName} completed`
        return {
          messages: [
            {
              id: partId,
              type: 'tool_result',
              content: output,
              timestamp: now,
              toolName,
              toolUseId,
              raw: part,
            },
          ],
          isTextDelta: false,
        }
      }
      if (status === 'error') {
        return {
          messages: [
            {
              id: partId,
              type: 'error',
              content: stringField(state, 'error') ?? `${toolName} failed`,
              timestamp: now,
              toolName,
              toolUseId,
              raw: part,
            },
          ],
          isTextDelta: false,
        }
      }
      return { messages: [], isTextDelta: false }
    }

    case 'step-start': {
      return {
        messages: [
          {
            id: partId,
            type: 'step',
            content: 'Step started',
            timestamp: now,
            stepPhase: 'start',
            stepSnapshot: stringField(part, 'snapshot'),
            raw: part,
          },
        ],
        isTextDelta: false,
      }
    }

    case 'step-finish': {
      const cost = numberField(part, 'cost') ?? 0
      const tokens = extractTokens(part.tokens)
      return {
        messages: [
          {
            id: partId,
            type: 'step',
            content: stringField(part, 'reason') ?? 'Step completed',
            timestamp: now,
            stepPhase: 'finish',
            stepReason: stringField(part, 'reason'),
            stepSnapshot: stringField(part, 'snapshot'),
            costUsd: cost,
            tokens,
            raw: part,
          },
        ],
        isTextDelta: false,
      }
    }

    case 'snapshot': {
      return {
        messages: [
          {
            id: partId,
            type: 'snapshot',
            content: 'Snapshot captured',
            timestamp: now,
            snapshotHash: stringField(part, 'snapshot'),
            raw: part,
          },
        ],
        isTextDelta: false,
      }
    }

    case 'patch': {
      const files = Array.isArray(part.files)
        ? (part.files as unknown[]).filter((f): f is string => typeof f === 'string')
        : []
      return {
        messages: [
          {
            id: partId,
            type: 'patch',
            content: files.length === 1 ? files[0] : `${files.length} files`,
            timestamp: now,
            patchHash: stringField(part, 'hash'),
            patchFiles: files,
            raw: part,
          },
        ],
        isTextDelta: false,
      }
    }

    case 'agent': {
      return {
        messages: [
          {
            id: partId,
            type: 'agent_change',
            content: stringField(part, 'name') ?? 'agent',
            timestamp: now,
            agentName: stringField(part, 'name'),
            raw: part,
          },
        ],
        isTextDelta: false,
      }
    }

    case 'retry': {
      const error = (part.error ?? {}) as Record<string, unknown>
      const errMsg =
        stringField((error.data as Record<string, unknown> | undefined) ?? {}, 'message') ??
        stringField(error, 'message') ??
        'retrying'
      return {
        messages: [
          {
            id: partId,
            type: 'retry',
            content: `Attempt ${numberField(part, 'attempt') ?? 1}: ${errMsg}`,
            timestamp: now,
            retryAttempt: numberField(part, 'attempt'),
            raw: part,
          },
        ],
        isTextDelta: false,
      }
    }

    case 'compaction': {
      return {
        messages: [
          {
            id: partId,
            type: 'compaction',
            content: 'Context compacted',
            timestamp: now,
            compactionAuto: part.auto === true,
            raw: part,
          },
        ],
        isTextDelta: false,
      }
    }

    case 'subtask': {
      return {
        messages: [
          {
            id: partId,
            type: 'subtask',
            content: stringField(part, 'description') ?? stringField(part, 'prompt') ?? 'Subtask',
            timestamp: now,
            subtaskPrompt: stringField(part, 'prompt'),
            subtaskDescription: stringField(part, 'description'),
            subtaskAgent: stringField(part, 'agent'),
            raw: part,
          },
        ],
        isTextDelta: false,
      }
    }

    default: {
      // Unknown part type — emit as a generic system message so it isn't lost.
      return {
        messages: [
          {
            id: partId,
            type: 'system',
            content: `Unknown part: ${partType}`,
            timestamp: now,
            raw: part,
          },
        ],
        isTextDelta: false,
      }
    }
  }
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = (value as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : undefined
}

function numberField(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = (value as Record<string, unknown>)[key]
  return typeof v === 'number' ? v : undefined
}

/** Extract token counts from an OpenCode AssistantMessage / StepFinishPart-style tokens object. */
export function extractTokens(value: unknown): CliAgentTokenUsage | undefined {
  if (!value || typeof value !== 'object') return undefined
  const t = value as Record<string, unknown>
  const cache = (t.cache ?? {}) as Record<string, unknown>
  const input = numberField(t, 'input') ?? 0
  const output = numberField(t, 'output') ?? 0
  const reasoning = numberField(t, 'reasoning') ?? 0
  const cacheRead = numberField(cache, 'read') ?? 0
  const cacheWrite = numberField(cache, 'write') ?? 0
  if (
    input === 0 &&
    output === 0 &&
    reasoning === 0 &&
    cacheRead === 0 &&
    cacheWrite === 0
  ) {
    return undefined
  }
  return { input, output, reasoning, cacheRead, cacheWrite }
}

/** Sum two token usage records. */
export function sumTokens(
  a: CliAgentTokenUsage | undefined,
  b: CliAgentTokenUsage | undefined,
): CliAgentTokenUsage | undefined {
  if (!a) return b
  if (!b) return a
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  }
}
