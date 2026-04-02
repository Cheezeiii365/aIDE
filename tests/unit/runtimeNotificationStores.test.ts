import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ChatToolCallPayload, PendingToolApprovalInfo } from '@aide/shared'
import {
  approvalInboxReplaceAll,
  approvalInboxUpsertFromToolCall,
  approvalInboxRemove,
  getApprovalInboxSnapshot,
  subscribeApprovalInbox,
  approvalInboxPendingCount,
} from '@renderer/lib/workspace/approvalInboxStore'
import {
  activityPushChatStreamEnd,
  activityPushCliResult,
  activityPushTask,
  getRuntimeActivitySnapshot,
  runtimeActivityClearForTests,
} from '@renderer/lib/workspace/runtimeActivityStore'

function sampleToolCallPayload(overrides: Partial<ChatToolCallPayload> = {}): ChatToolCallPayload {
  return {
    workspaceId: 'ws-a',
    sessionId: 'sess-1',
    toolCall: {
      id: 'tc-1',
      name: 'file_write',
      input: { path: 'x' },
      status: 'pending',
    },
    ...overrides,
  }
}

describe('approvalInboxStore', () => {
  beforeEach(() => {
    approvalInboxReplaceAll([])
  })

  it('replaceAll sets snapshot', () => {
    const rows: PendingToolApprovalInfo[] = [sampleToolCallPayload()]
    approvalInboxReplaceAll(rows)
    expect(getApprovalInboxSnapshot()).toHaveLength(1)
    expect(getApprovalInboxSnapshot()[0].toolCall.name).toBe('file_write')
  })

  it('upsertFromToolCall adds pending manual approvals', () => {
    approvalInboxUpsertFromToolCall(sampleToolCallPayload())
    expect(approvalInboxPendingCount()).toBe(1)
    approvalInboxUpsertFromToolCall(sampleToolCallPayload({
      toolCall: {
        id: 'tc-1',
        name: 'file_write',
        input: { path: 'y' },
        status: 'pending',
      },
    }))
    expect(approvalInboxPendingCount()).toBe(1)
    expect(getApprovalInboxSnapshot()[0].toolCall.input).toEqual({ path: 'y' })
  })

  it('skips auto-approved tool calls', () => {
    approvalInboxUpsertFromToolCall(sampleToolCallPayload({
      toolCall: { id: 't', name: 'x', input: {}, status: 'pending', autoApproved: true },
    }))
    expect(approvalInboxPendingCount()).toBe(0)
  })

  it('removes when status is not pending', () => {
    approvalInboxUpsertFromToolCall(sampleToolCallPayload())
    approvalInboxUpsertFromToolCall(sampleToolCallPayload({
      toolCall: {
        id: 'tc-1',
        name: 'file_write',
        input: {},
        status: 'approved',
      },
    }))
    expect(approvalInboxPendingCount()).toBe(0)
  })

  it('approvalInboxRemove drops row', () => {
    approvalInboxUpsertFromToolCall(sampleToolCallPayload())
    approvalInboxRemove('ws-a', 'sess-1', 'tc-1')
    expect(approvalInboxPendingCount()).toBe(0)
  })

  it('notifies subscribers', () => {
    const spy = vi.fn()
    const unsub = subscribeApprovalInbox(spy)
    approvalInboxUpsertFromToolCall(sampleToolCallPayload())
    expect(spy).toHaveBeenCalled()
    unsub()
  })
})

describe('runtimeActivityStore', () => {
  beforeEach(() => {
    runtimeActivityClearForTests()
  })

  it('records chat stream errors', () => {
    activityPushChatStreamEnd('ws-1', 's1', 'error', 'boom')
    const snap = getRuntimeActivitySnapshot()
    expect(snap[0].kind).toBe('agent_chat')
    expect(snap[0].summary).toContain('boom')
  })

  it('records CLI results', () => {
    activityPushCliResult('ws-1', 's1', true, 0.42)
    expect(getRuntimeActivitySnapshot()[0].kind).toBe('agent_cli')
  })

  it('ignores running task updates', () => {
    activityPushTask({
      workspaceId: 'w',
      executionId: 'e',
      taskId: 't',
      taskLabel: 'Build',
      status: 'running',
      startedAt: 0,
      ptyId: 'p',
    })
    expect(getRuntimeActivitySnapshot()).toHaveLength(0)
  })

  it('records finished tasks', () => {
    activityPushTask({
      workspaceId: 'w',
      executionId: 'e',
      taskId: 't',
      taskLabel: 'Build',
      status: 'failed',
      startedAt: 0,
      ptyId: 'p',
      exitCode: 1,
    })
    expect(getRuntimeActivitySnapshot()[0].summary).toContain('failed')
  })
})
