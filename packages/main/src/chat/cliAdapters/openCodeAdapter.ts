/**
 * OpenCode adapter — thin per-turn driver for the OpenCode SDK.
 *
 * Unlike the previous implementation, this adapter no longer spawns or owns a
 * server process. The workspace's `OpenCodeServerHost` already runs a
 * persistent `opencode serve` and exposes a shared SSE pump. The adapter:
 *
 *   1. Gets a client from the host
 *   2. Creates an OpenCode session if one doesn't already exist
 *   3. Subscribes to per-session SSE events via the host
 *   4. Issues `promptAsync` with all overrides from backend state
 *      (model / agent / system / tools)
 *   5. Converts each part via `openCodePartConverter`
 *   6. Aggregates cost + tokens and emits a `result` event when the session
 *      goes idle (or fails)
 *
 * Permission events are forwarded to the manager via the new
 * `permission-request` event variant — the manager bridges them to the
 * existing CHAT_TOOL_CALL approval surface and POSTs the response back via
 * `host.respondPermission()`.
 */

import { randomUUID } from 'crypto'
import type { CliAgentMessage, PermissionTier, ToolPermissionConfig } from '@aide/shared'
import type { OpenCodeServerHost } from '../openCodeServerHost'
import { decideOpenCodePermission } from './openCodePermissionBridge'
import {
  convertOpenCodePart,
  createConvertContext,
  extractTokens,
  sumTokens,
} from './openCodePartConverter'
import type {
  CliBackendAdapter,
  CliBackendEvent,
  CliBackendRun,
  CliBackendTurnContext,
} from './types'

export interface OpenCodeAdapterOptions {
  host: OpenCodeServerHost
  /** Permission settings snapshot at the time the turn was initiated. */
  getPermissionSettings: () => {
    tier: PermissionTier
    autoApprove: Record<string, boolean | ToolPermissionConfig>
  }
}

export function createOpenCodeAdapter(options: OpenCodeAdapterOptions): CliBackendAdapter {
  return {
    backend: 'opencode',
    startTurn(context, emit) {
      return runOpenCodeTurn(options, context, emit)
    },
  }
}

function runOpenCodeTurn(
  options: OpenCodeAdapterOptions,
  context: CliBackendTurnContext,
  emit: (event: CliBackendEvent) => void,
): CliBackendRun {
  const startedAt = Date.now()
  let unsubscribe: (() => void) | null = null
  let closed = false
  let promptSubmitted = false
  let sessionIdRef: string | null = context.backendState.sessionId ?? null

  const partCtx = createConvertContext()
  const textByMessageId = new Map<string, string>()
  const emittedAssistantIds = new Set<string>()
  const seenPartFinalIds = new Set<string>()
  const costByMessageId = new Map<string, number>()
  const tokensByMessageId = new Map<string, ReturnType<typeof extractTokens>>()
  let totalCostUsd = 0
  let totalTokens: ReturnType<typeof extractTokens> = undefined
  let failedError: string | null = null
  let idleResolve: (() => void) | null = null
  const idlePromise = new Promise<void>((resolve) => {
    idleResolve = resolve
  })

  const completed = (async () => {
    const client = await options.host.getClient()

    // Ensure we have a session.
    if (!sessionIdRef) {
      const created = await (
        client as unknown as {
          session: {
            create: (opts?: {
              body?: { title?: string }
              query?: { directory?: string }
            }) => Promise<unknown>
          }
        }
      ).session.create({ query: { directory: context.cwd } })
      const id = extractSessionId(created)
      if (!id) throw new Error('OpenCode session.create returned no id')
      sessionIdRef = id
      emit({ type: 'backend-state', patch: { sessionId: id } })
    }
    const sessionId = sessionIdRef
    if (!sessionId) throw new Error('OpenCode session unavailable')

    // Subscribe BEFORE issuing the prompt so we don't miss early events.
    unsubscribe = options.host.subscribe(sessionId, (rawEvent) => {
      handleEvent(rawEvent)
    })

    // Build the prompt body using per-session backend state overrides.
    const state = context.backendState
    const body: Record<string, unknown> = {
      parts: [{ type: 'text', text: context.prompt }],
    }
    if (state.providerID && state.modelID) {
      body.model = { providerID: state.providerID, modelID: state.modelID }
    } else if (state.model && state.model.includes('/')) {
      const [providerID, modelID] = state.model.split('/', 2)
      body.model = { providerID, modelID }
    }
    if (state.agent) body.agent = state.agent
    if (state.systemPromptOverride) body.system = state.systemPromptOverride
    if (state.toolToggles) body.tools = state.toolToggles

    await (
      client as unknown as {
        session: {
          promptAsync: (opts: {
            path: { id: string }
            query?: { directory?: string }
            body: Record<string, unknown>
          }) => Promise<unknown>
        }
      }
    ).session.promptAsync({
      path: { id: sessionId },
      query: { directory: context.cwd },
      body,
    })
    promptSubmitted = true

    // Wait for session.idle (or session.error which sets failedError).
    await idlePromise

    // Emit any final assistant text accumulators that weren't already emitted.
    for (const [messageId, text] of textByMessageId) {
      if (!text) continue
      if (emittedAssistantIds.has(messageId)) continue
      if (seenPartFinalIds.has(messageId)) continue
      emittedAssistantIds.add(messageId)
      const message: Omit<CliAgentMessage, 'backend'> = {
        id: messageId,
        type: 'assistant',
        content: text,
        timestamp: Date.now(),
        tokens: tokensByMessageId.get(messageId),
        costUsd: costByMessageId.get(messageId),
      }
      emit({ type: 'message', message })
    }

    if (failedError) {
      emit({
        type: 'message',
        message: {
          id: randomUUID(),
          type: 'error',
          content: failedError,
          timestamp: Date.now(),
        },
      })
      emit({
        type: 'result',
        durationMs: Date.now() - startedAt,
        totalCostUsd,
        tokens: totalTokens,
        isSuccess: false,
      })
      return
    }

    emit({
      type: 'message',
      message: {
        id: randomUUID(),
        type: 'result',
        content: `Completed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
        timestamp: Date.now(),
        totalCostUsd,
        tokens: totalTokens,
        isSuccess: true,
      },
    })
    emit({
      type: 'result',
      durationMs: Date.now() - startedAt,
      totalCostUsd,
      tokens: totalTokens,
      isSuccess: true,
    })
  })().finally(() => {
    if (unsubscribe) {
      try {
        unsubscribe()
      } catch {
        /* ignore */
      }
      unsubscribe = null
    }
  })

  function handleEvent(rawEvent: unknown): void {
    if (closed) return
    const event = rawEvent as { type?: string; properties?: Record<string, unknown> }
    const type = typeof event.type === 'string' ? event.type : ''
    const props = (event.properties ?? {}) as Record<string, unknown>

    if (type === 'message.updated' && (props.info as Record<string, unknown> | undefined)) {
      const info = props.info as Record<string, unknown>
      const role = info.role
      const messageId = (info.id as string | undefined) ?? randomUUID()
      if (role === 'assistant') {
        const providerID = info.providerID as string | undefined
        const modelID = info.modelID as string | undefined
        const model = [providerID, modelID].filter(Boolean).join('/') || undefined
        if (model) {
          emit({ type: 'session-meta', model })
          emit({ type: 'backend-state', patch: { sessionId: sessionIdRef ?? undefined, model } })
        }
        const cost = typeof info.cost === 'number' ? info.cost : 0
        const prevCost = costByMessageId.get(messageId) ?? 0
        const delta = Math.max(0, cost - prevCost)
        totalCostUsd += delta
        costByMessageId.set(messageId, cost)

        const tokens = extractTokens(info.tokens)
        if (tokens) {
          tokensByMessageId.set(messageId, tokens)
          totalTokens = recomputeTotals(tokensByMessageId)
        }

        const errorText = renderOpenCodeError(info.error)
        if (errorText) failedError = errorText
      }
      return
    }

    if (type === 'message.part.updated' && props.part) {
      const part = props.part as Record<string, unknown>
      const messageId = (part.messageID as string | undefined) ?? randomUUID()
      const delta = typeof props.delta === 'string' ? (props.delta as string) : undefined
      const converted = convertOpenCodePart(part, delta, partCtx)

      if (converted.isTextDelta && converted.delta) {
        const prior = textByMessageId.get(converted.messageId ?? messageId) ?? ''
        textByMessageId.set(converted.messageId ?? messageId, prior + converted.delta)
        emit({
          type: 'stream-delta',
          messageId: converted.messageId ?? messageId,
          delta: converted.delta,
        })
      }
      for (const message of converted.messages) {
        if (message.type === 'assistant') {
          emittedAssistantIds.add(message.id)
          seenPartFinalIds.add(message.id)
        }
        emit({ type: 'message', message })
      }
      return
    }

    if (type === 'permission.updated' && props) {
      const perm = props as Record<string, unknown>
      const permissionId = perm.id as string | undefined
      const sessionID = perm.sessionID as string | undefined
      if (!permissionId || !sessionID) return

      const settings = options.getPermissionSettings()
      const decision = decideOpenCodePermission(
        {
          category: (perm.type as string) ?? 'unknown',
          pattern: perm.pattern as string | string[] | undefined,
          metadata: perm.metadata as Record<string, unknown> | undefined,
        },
        settings.tier,
        settings.autoApprove,
      )

      if (decision === 'always' || decision === 'reject') {
        void options.host.respondPermission(sessionID, permissionId, decision).catch(() => {
          // Surface as error if response fails.
        })
        return
      }

      // Forward to the manager via a synthetic permission-request event.
      emit({
        type: 'permission-request',
        request: {
          permissionId,
          sessionId: sessionID,
          category: (perm.type as string) ?? 'unknown',
          title: (perm.title as string) ?? 'Permission required',
          pattern: perm.pattern as string | string[] | undefined,
          metadata: perm.metadata as Record<string, unknown> | undefined,
        },
        resolve: (response) => {
          void options.host.respondPermission(sessionID, permissionId, response).catch(() => {
            /* ignore */
          })
        },
      })
      return
    }

    if (type === 'session.error' && props) {
      if (sessionIdRef && typeof props.sessionID === 'string' && props.sessionID !== sessionIdRef) {
        return
      }
      failedError = renderOpenCodeError(props.error) ?? 'OpenCode session failed'
      if (idleResolve) {
        idleResolve()
        idleResolve = null
      }
      return
    }

    if (type === 'session.idle' && props.sessionID === sessionIdRef && promptSubmitted) {
      if (idleResolve) {
        idleResolve()
        idleResolve = null
      }
      return
    }
  }

  return {
    close() {
      closed = true
      if (idleResolve) {
        idleResolve()
        idleResolve = null
      }
      if (unsubscribe) {
        try {
          unsubscribe()
        } catch {
          /* ignore */
        }
        unsubscribe = null
      }
    },
    completed,
  }
}

function recomputeTotals(
  byId: Map<string, ReturnType<typeof extractTokens>>,
): ReturnType<typeof extractTokens> {
  let acc: ReturnType<typeof extractTokens> = undefined
  for (const value of byId.values()) {
    acc = sumTokens(acc, value)
  }
  return acc
}

function extractSessionId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.id === 'string') return v.id
  const data = v.data as Record<string, unknown> | undefined
  if (data && typeof data.id === 'string') return data.id
  return null
}

function renderOpenCodeError(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const error = value as Record<string, unknown>
  const data = (error.data ?? {}) as Record<string, unknown>
  const message = typeof data.message === 'string' ? (data.message as string) : null
  return message ?? null
}
