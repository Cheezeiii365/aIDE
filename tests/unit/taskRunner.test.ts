import { describe, it, expect } from 'vitest'
import { IpcChannels } from '@shared/index'
import type { TaskRunContext, TaskTriggerResult, TaskExecution } from '@shared/index'

describe('Task system IPC channels', () => {
  it('defines TASK_FILE_SAVED channel', () => {
    expect(IpcChannels.TASK_FILE_SAVED).toBe('task:file-saved')
  })

  it('defines TASK_TRIGGER_RESULT channel', () => {
    expect(IpcChannels.TASK_TRIGGER_RESULT).toBe('task:trigger-result')
  })
})

describe('Task system types', () => {
  it('TaskRunContext is structurally valid', () => {
    const ctx: TaskRunContext = {
      activeFile: '/src/index.ts',
      selectedText: 'hello',
      lineNumber: 42,
    }
    expect(ctx.activeFile).toBe('/src/index.ts')
    expect(ctx.selectedText).toBe('hello')
    expect(ctx.lineNumber).toBe(42)
  })

  it('TaskRunContext fields are optional', () => {
    const ctx: TaskRunContext = {}
    expect(ctx.activeFile).toBeUndefined()
  })

  it('TaskTriggerResult carries expected shape', () => {
    const result: TaskTriggerResult = {
      taskId: 'build',
      taskLabel: 'Build',
      source: 'workspaceOpen',
      outcome: 'started',
    }
    expect(result.outcome).toBe('started')
    expect(result.message).toBeUndefined()
  })

  it('TaskTriggerResult supports failure with message', () => {
    const result: TaskTriggerResult = {
      taskId: 'lint',
      taskLabel: 'Lint',
      source: 'fileSave',
      outcome: 'failed',
      message: 'Task not found',
    }
    expect(result.outcome).toBe('failed')
    expect(result.message).toBe('Task not found')
  })

  it('TaskExecution includes panelPolicy and closeOnExit', () => {
    const exec: TaskExecution = {
      workspaceId: 'ws-1',
      executionId: 'exec-1',
      taskId: 'build',
      taskLabel: 'Build',
      status: 'running',
      startedAt: Date.now(),
      ptyId: 'pty-1',
      panelPolicy: 'dedicated',
      closeOnExit: true,
    }
    expect(exec.panelPolicy).toBe('dedicated')
    expect(exec.closeOnExit).toBe(true)
  })

  it('TaskExecution panelPolicy and closeOnExit are optional', () => {
    const exec: TaskExecution = {
      workspaceId: 'ws-1',
      executionId: 'exec-2',
      taskId: 'test',
      taskLabel: 'Test',
      status: 'succeeded',
      startedAt: Date.now(),
      ptyId: 'pty-2',
    }
    expect(exec.panelPolicy).toBeUndefined()
    expect(exec.closeOnExit).toBeUndefined()
  })
})
