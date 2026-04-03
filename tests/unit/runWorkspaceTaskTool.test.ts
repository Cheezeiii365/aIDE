import { describe, it, expect, vi } from 'vitest'
import { BUILTIN_TOOLS } from '@main/chat/agentTools'

const tool = BUILTIN_TOOLS.find((t) => t.definition.name === 'run_workspace_task')

describe('run_workspace_task builtin', () => {
  it('is registered', () => {
    expect(tool).toBeDefined()
  })

  it('returns a clear message when runWorkspaceTask is not wired', async () => {
    const out = await tool!.execute({ taskId: 'build' }, { workspaceRoot: '/tmp' })
    expect(out).toContain('not wired')
  })

  it('delegates to runWorkspaceTask with effectiveRoot as workspaceRoot in context', async () => {
    const run = vi.fn().mockResolvedValue({
      workspaceId: 'w1',
      executionId: 'e1',
      taskId: 'build',
      taskLabel: 'Build',
      status: 'running' as const,
      startedAt: 1,
      ptyId: 'p1',
    })
    const out = await tool!.execute(
      { taskId: 'build' },
      { workspaceRoot: '/proj', effectiveRoot: '/wt', runWorkspaceTask: run },
    )
    expect(run).toHaveBeenCalledWith(
      'build',
      expect.objectContaining({ workspaceRoot: '/wt', workspaceName: 'wt' }),
    )
    expect(out).toContain('Build')
    expect(out).toContain('e1')
  })

  it('propagates runner error string', async () => {
    const run = vi.fn().mockResolvedValue({ error: 'Task not found' })
    const out = await tool!.execute(
      { taskId: 'nope' },
      { workspaceRoot: '/proj', runWorkspaceTask: run },
    )
    expect(out).toContain('Task not found')
  })
})
