import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { TaskExecution } from '@aide/shared'
import { useTasks } from '@renderer/hooks/useTasks'

function stubWindowApi(overrides: Record<string, unknown> = {}) {
  const api = {
    listTasks: vi.fn().mockResolvedValue({ tasks: [], compounds: [] }),
    listRunningTasks: vi.fn().mockResolvedValue([]),
    runTask: vi.fn().mockResolvedValue({ executionId: 'e1' }),
    killTask: vi.fn(),
    reloadTasks: vi.fn().mockResolvedValue(undefined),
    onTaskStatusChanged: vi.fn().mockReturnValue(() => {}),
    onTaskDiagnostics: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  }
  Object.defineProperty(window, 'api', { value: api, writable: true, configurable: true })
  return api
}

describe('useTasks', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'api')
  })

  it('calls listRunningTasks when workspaceId is set to hydrate running tasks', async () => {
    const running: TaskExecution = {
      workspaceId: 'ws-a',
      executionId: 'ex-1',
      taskId: 't1',
      taskLabel: 'Task One',
      status: 'running',
      startedAt: 1,
      ptyId: 'pty-1',
    }
    const api = stubWindowApi({
      listRunningTasks: vi.fn().mockResolvedValue([running]),
    })

    const { result } = renderHook(() => useTasks('ws-a'))

    await waitFor(() => {
      expect(api.listRunningTasks).toHaveBeenCalledWith('ws-a')
      expect(result.current.runningTasks).toEqual([running])
    })
  })

  it('clears running tasks when workspaceId becomes null', async () => {
    const running: TaskExecution = {
      workspaceId: 'ws-a',
      executionId: 'ex-1',
      taskId: 't1',
      taskLabel: 'Task One',
      status: 'running',
      startedAt: 1,
      ptyId: 'pty-1',
    }
    stubWindowApi({
      listRunningTasks: vi.fn().mockResolvedValue([running]),
    })

    const { result, rerender } = renderHook(({ wid }: { wid: string | null }) => useTasks(wid), {
      initialProps: { wid: 'ws-a' as string | null },
    })

    await waitFor(() => {
      expect(result.current.runningTasks.length).toBe(1)
    })

    rerender({ wid: null })

    await waitFor(() => {
      expect(result.current.runningTasks).toEqual([])
    })
  })
})
