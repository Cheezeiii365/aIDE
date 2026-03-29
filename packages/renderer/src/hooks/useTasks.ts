import { useState, useEffect, useCallback, useRef } from 'react'
import type { AideTask, CompoundTask, TaskExecution } from '@aide/shared'

export interface TasksState {
  tasks: AideTask[]
  compounds: CompoundTask[]
  runningTasks: TaskExecution[]
  /** Snapshot at last render; prefer `getLastTaskId()` for command handlers. */
  lastTaskId: string | null
  getLastTaskId: () => string | null
  getRunningTasks: () => TaskExecution[]
  runTask: (taskId: string) => Promise<void>
  killTask: (executionId: string) => void
  reloadTasks: () => Promise<void>
}

/**
 * React hook that manages available tasks, compound tasks, and currently running task executions.
 *
 * Returns an object providing current task lists, active executions, the most-recently requested task id,
 * and actions to run, kill, or reload tasks.
 *
 * @returns An object with:
 * - `tasks`: array of available `AideTask` definitions
 * - `compounds`: array of available `CompoundTask` definitions
 * - `runningTasks`: array of active `TaskExecution` entries
 * - `lastTaskId`: snapshot at last render; use `getLastTaskId()` from keybindings/commands
 * - `getLastTaskId()`, `getRunningTasks()`: fresh reads for command handlers
 * - `runTask(taskId)`: function to start a task by id
 * - `killTask(executionId)`: function to stop an execution by id
 * - `reloadTasks()`: function to refresh task definitions
 */
export function useTasks(): TasksState {
  const [tasks, setTasks] = useState<AideTask[]>([])
  const [compounds, setCompounds] = useState<CompoundTask[]>([])
  const [runningTasks, setRunningTasks] = useState<TaskExecution[]>([])
  const lastTaskIdRef = useRef<string | null>(null)
  const runningTasksRef = useRef<TaskExecution[]>([])
  runningTasksRef.current = runningTasks

  // Load tasks on mount
  useEffect(() => {
    window.api.listTasks().then(({ tasks: t, compounds: c }) => {
      setTasks(t)
      setCompounds(c)
    })
  }, [])

  // Subscribe to status changes
  useEffect(() => {
    const unsub = window.api.onTaskStatusChanged((execution) => {
      setRunningTasks((prev) => {
        if (execution.status === 'running') {
          // Add or update
          const existing = prev.findIndex((e) => e.executionId === execution.executionId)
          if (existing >= 0) {
            const next = [...prev]
            next[existing] = execution
            return next
          }
          return [...prev, execution]
        }
        // Remove completed/failed/killed
        return prev.filter((e) => e.executionId !== execution.executionId)
      })
    })
    return unsub
  }, [])

  const runTask = useCallback(async (taskId: string) => {
    lastTaskIdRef.current = taskId
    await window.api.runTask(taskId)
  }, [])

  const killTask = useCallback((executionId: string) => {
    window.api.killTask(executionId)
  }, [])

  const reloadTasks = useCallback(async () => {
    await window.api.reloadTasks()
    const { tasks: t, compounds: c } = await window.api.listTasks()
    setTasks(t)
    setCompounds(c)
  }, [])

  const getLastTaskId = useCallback(() => lastTaskIdRef.current, [])

  const getRunningTasks = useCallback(() => runningTasksRef.current, [])

  return {
    tasks,
    compounds,
    runningTasks,
    lastTaskId: lastTaskIdRef.current,
    getLastTaskId,
    getRunningTasks,
    runTask,
    killTask,
    reloadTasks,
  }
}
