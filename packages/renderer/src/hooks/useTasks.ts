import { useState, useEffect, useCallback, useRef } from 'react'
import type { AideTask, CompoundTask, TaskExecution } from '@aide/shared'

export interface TasksState {
  tasks: AideTask[]
  compounds: CompoundTask[]
  runningTasks: TaskExecution[]
  lastTaskId: string | null
  runTask: (taskId: string) => Promise<void>
  killTask: (executionId: string) => void
  reloadTasks: () => Promise<void>
}

export function useTasks(): TasksState {
  const [tasks, setTasks] = useState<AideTask[]>([])
  const [compounds, setCompounds] = useState<CompoundTask[]>([])
  const [runningTasks, setRunningTasks] = useState<TaskExecution[]>([])
  const lastTaskIdRef = useRef<string | null>(null)

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

  return {
    tasks,
    compounds,
    runningTasks,
    lastTaskId: lastTaskIdRef.current,
    runTask,
    killTask,
    reloadTasks,
  }
}
