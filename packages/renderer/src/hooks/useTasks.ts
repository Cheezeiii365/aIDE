import { useState, useEffect, useCallback, useRef } from 'react'
import type { AideTask, CompoundTask, TaskExecution, TaskDiagnostic, TaskRunContext } from '@aide/shared'
import { getActiveEditor } from '../lib/editor/activeEditor'
import { scopedTo } from '../lib/workspace/workspaceScopedListener'

export interface TasksState {
  tasks: AideTask[]
  compounds: CompoundTask[]
  runningTasks: TaskExecution[]
  diagnostics: TaskDiagnostic[]
  /** Snapshot at last render; prefer `getLastTaskId()` for command handlers. */
  lastTaskId: string | null
  getLastTaskId: () => string | null
  getRunningTasks: () => TaskExecution[]
  runTask: (taskId: string) => Promise<void>
  killTask: (executionId: string) => void
  reloadTasks: () => Promise<void>
  clearDiagnostics: () => void
  clearDiagnosticsForTask: (taskId: string) => void
}

/**
 * React hook that manages available tasks, compound tasks, running executions, and diagnostics.
 *
 * Gathers active editor context (file, selection, line) when running tasks so that
 * ${file}, ${selectedText}, ${lineNumber} variables resolve correctly in the main process.
 *
 * @param workspaceId - When set, task executions and diagnostics from other workspaces are ignored (focused-workspace UI).
 */
export function useTasks(workspaceId: string | null): TasksState {
  const [tasks, setTasks] = useState<AideTask[]>([])
  const [compounds, setCompounds] = useState<CompoundTask[]>([])
  const [runningTasks, setRunningTasks] = useState<TaskExecution[]>([])
  const [diagnostics, setDiagnostics] = useState<TaskDiagnostic[]>([])
  const lastTaskIdRef = useRef<string | null>(null)
  const runningTasksRef = useRef<TaskExecution[]>([])
  runningTasksRef.current = runningTasks

  // Load tasks when workspace focus changes (main `listTasks` is scoped to focused runtime)
  useEffect(() => {
    if (!workspaceId) {
      setTasks([])
      setCompounds([])
      setRunningTasks([])
      setDiagnostics([])
      return
    }
    window.api.listTasks(workspaceId).then(({ tasks: t, compounds: c }) => {
      setTasks(t)
      setCompounds(c)
    })
  }, [workspaceId])

  // Subscribe to status changes
  useEffect(() => {
    const unsub = window.api.onTaskStatusChanged((execution) => {
      if (!workspaceId || execution.workspaceId !== workspaceId) {
        if (execution.status !== 'running') {
          setRunningTasks((prev) => prev.filter((e) => e.executionId !== execution.executionId))
        }
        return
      }
      setRunningTasks((prev) => {
        if (execution.status === 'running') {
          // Clear diagnostics for this task when it starts
          setDiagnostics((d) => d.filter((diag) => diag.source !== execution.taskId))
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
  }, [workspaceId])

  // Subscribe to diagnostics
  useEffect(() => {
    const unsub = window.api.onTaskDiagnostics(scopedTo(workspaceId, (payload) => {
      setDiagnostics((prev) => [...prev, ...payload.diagnostics])
    }))
    return unsub
  }, [workspaceId])

  const runTask = useCallback(async (taskId: string) => {
    lastTaskIdRef.current = taskId

    // Gather active editor context for variable resolution
    const editor = getActiveEditor()
    let context: TaskRunContext | undefined
    if (editor) {
      const { view, filePath } = editor
      const sel = view.state.selection.main
      const selectedText = view.state.sliceDoc(sel.from, sel.to) || undefined
      const lineNumber = view.state.doc.lineAt(sel.head).number
      context = { activeFile: filePath, selectedText, lineNumber }
    }

    if (!workspaceId) return
    await window.api.runTask(workspaceId, taskId, context)
  }, [workspaceId])

  const killTask = useCallback((executionId: string) => {
    if (!workspaceId) return
    window.api.killTask(workspaceId, executionId)
  }, [workspaceId])

  const reloadTasks = useCallback(async () => {
    if (!workspaceId) return
    await window.api.reloadTasks(workspaceId)
    const { tasks: t, compounds: c } = await window.api.listTasks(workspaceId)
    setTasks(t)
    setCompounds(c)
  }, [workspaceId])

  const getLastTaskId = useCallback(() => lastTaskIdRef.current, [])
  const getRunningTasks = useCallback(() => runningTasksRef.current, [])
  const clearDiagnostics = useCallback(() => setDiagnostics([]), [])
  const clearDiagnosticsForTask = useCallback((taskId: string) => {
    setDiagnostics((prev) => prev.filter((d) => d.source !== taskId))
  }, [])

  return {
    tasks,
    compounds,
    runningTasks,
    diagnostics,
    lastTaskId: lastTaskIdRef.current,
    getLastTaskId,
    getRunningTasks,
    runTask,
    killTask,
    reloadTasks,
    clearDiagnostics,
    clearDiagnosticsForTask,
  }
}
