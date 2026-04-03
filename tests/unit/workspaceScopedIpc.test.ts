import { describe, expect, it, vi } from 'vitest'
import type {
  GitStatusChangedPayload,
  PtyDataOutPayload,
  PtyExitPayload,
  TaskExecution,
  GitignoreAuditIpcPayload,
} from '@aide/shared'
import { scopedTo } from '../../packages/renderer/src/lib/workspace/workspaceScopedListener'

/**
 * Structural fixtures: Phase 2 payloads must be workspace-addressable so the renderer
 * can ignore foreign workspaces without relying on the active-workspace singleton.
 */
describe('workspace-scoped IPC payload shapes', () => {
  it('includes workspaceId on runtime push examples', () => {
    const git: GitStatusChangedPayload = {
      workspaceId: 'ws-a',
      status: { branch: 'main', files: [] },
    }
    const ptyOut: PtyDataOutPayload = {
      workspaceId: 'ws-a',
      ptyId: 'pty-1',
      data: 'hello',
    }
    const ptyExit: PtyExitPayload = {
      workspaceId: 'ws-a',
      ptyId: 'pty-1',
      exitCode: 0,
    }
    const task: TaskExecution = {
      workspaceId: 'ws-a',
      executionId: 'ex-1',
      taskId: 'build',
      taskLabel: 'build',
      status: 'running',
      startedAt: Date.now(),
      ptyId: 'pty-task-1',
    }
    const audit: GitignoreAuditIpcPayload = {
      workspaceId: 'ws-a',
      result: { missing: [], total: 0 },
    }

    expect(git.workspaceId).toBe('ws-a')
    expect(ptyOut.workspaceId).toBe('ws-a')
    expect(ptyExit.workspaceId).toBe('ws-a')
    expect(task.workspaceId).toBe('ws-a')
    expect(audit.workspaceId).toBe('ws-a')
  })
})

describe('scopedTo helper', () => {
  it('invokes handler when workspaceId matches', () => {
    const handler = vi.fn()
    const scoped = scopedTo('ws-1', handler)
    const payload = { workspaceId: 'ws-1', data: 'test' }
    scoped(payload)
    expect(handler).toHaveBeenCalledWith(payload)
  })

  it('skips handler when workspaceId differs', () => {
    const handler = vi.fn()
    const scoped = scopedTo('ws-1', handler)
    scoped({ workspaceId: 'ws-2', data: 'test' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('skips handler when caller workspaceId is null', () => {
    const handler = vi.fn()
    const scoped = scopedTo(null, handler)
    scoped({ workspaceId: 'ws-1', data: 'test' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('skips handler when caller workspaceId is undefined', () => {
    const handler = vi.fn()
    const scoped = scopedTo(undefined, handler)
    scoped({ workspaceId: 'ws-1', data: 'test' })
    expect(handler).not.toHaveBeenCalled()
  })
})
