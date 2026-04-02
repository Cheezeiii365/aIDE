/**
 * Task runner engine.
 *
 * Loads .aide/tasks.json, validates the schema, spawns task processes via node-pty,
 * manages lifecycle (start, kill, restart), resolves dependsOn graphs, and handles
 * compound tasks. Emits status changes and diagnostics via callbacks.
 */

import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join, resolve } from 'path'
import { spawn, type IPty } from 'node-pty'
import { randomUUID } from 'crypto'
import type {
  AideTasksFile,
  AideTask,
  CompoundTask,
  TaskInput,
  TaskExecution,
  TaskExecutionStatus,
  TaskDiagnostic,
  TaskInputRequest,
} from '@aide/shared'
import { resolveVariables, findInputReferences, type TaskVariableContext } from './taskVariableResolver'
import { createMatcher, type BuiltinMatcherName } from './problemMatcher'

export interface TaskRunnerCallbacks {
  onStatusChanged: (execution: TaskExecution) => void
  onRequestInput: (request: TaskInputRequest) => void
  onDiagnostics: (diagnostics: TaskDiagnostic[]) => void
  onPtyData: (ptyId: string, data: string) => void
  onPtyExit: (ptyId: string, exitCode: number) => void
}

interface RunningTask {
  execution: TaskExecution
  pty: IPty
  task: AideTask
  timeoutTimer?: ReturnType<typeof setTimeout>
}

export class TaskRunner {
  private tasksFile: AideTasksFile | null = null
  private running = new Map<string, RunningTask>()
  private completedExitCodes = new Map<string, number>()
  private lastTaskId: string | null = null
  private rootPath: string
  private readonly workspaceId: string
  private callbacks: TaskRunnerCallbacks
  private pendingInputResolvers = new Map<string, (value: string | null) => void>()

  constructor(rootPath: string, workspaceId: string, callbacks: TaskRunnerCallbacks) {
    this.rootPath = rootPath
    this.workspaceId = workspaceId
    this.callbacks = callbacks
  }

  /**
   * Load and parse .aide/tasks.json. Returns false if file doesn't exist or is invalid.
   */
  async loadTasks(): Promise<boolean> {
    const tasksPath = join(this.rootPath, '.aide', 'tasks.json')
    if (!existsSync(tasksPath)) {
      this.tasksFile = null
      return false
    }

    try {
      const raw = await readFile(tasksPath, 'utf-8')
      const parsed = JSON.parse(raw) as AideTasksFile
      if (!parsed.version || !Array.isArray(parsed.tasks)) {
        this.tasksFile = null
        return false
      }
      this.tasksFile = parsed
      return true
    } catch {
      this.tasksFile = null
      return false
    }
  }

  getTasks(): AideTask[] {
    return this.tasksFile?.tasks ?? []
  }

  getCompounds(): CompoundTask[] {
    return this.tasksFile?.compounds ?? []
  }

  getInputs(): TaskInput[] {
    return this.tasksFile?.inputs ?? []
  }

  getLastTaskId(): string | null {
    return this.lastTaskId
  }

  getRunning(): TaskExecution[] {
    return Array.from(this.running.values()).map((r) => r.execution)
  }

  /**
   * Check if a task with the given taskId is currently running.
   */
  isTaskRunning(taskId: string): boolean {
    for (const r of this.running.values()) {
      if (r.execution.taskId === taskId) return true
    }
    return false
  }

  /**
   * Get the running execution for a given taskId, if any.
   */
  getRunningExecutionByTaskId(taskId: string): TaskExecution | null {
    for (const r of this.running.values()) {
      if (r.execution.taskId === taskId) return r.execution
    }
    return null
  }

  /**
   * Resolve a task by ID, applying platform-specific overrides.
   */
  private resolveTask(taskId: string): AideTask | null {
    const task = this.tasksFile?.tasks.find((t) => t.id === taskId)
    if (!task) return null

    // Apply platform overrides
    const platform = process.platform as 'darwin' | 'linux' | 'win32'
    const override = task.os?.[platform]
    if (override) {
      return { ...task, ...override, id: task.id, os: undefined }
    }
    return task
  }

  /**
   * Apply file-level defaults to a task.
   */
  private applyDefaults(task: AideTask): AideTask {
    const defaults = this.tasksFile?.defaults
    if (!defaults) return task

    return {
      ...task,
      shell: task.shell ?? defaults.shell,
      env: { ...defaults.env, ...task.env },
      presentation: { ...defaults.presentation, ...task.presentation },
    }
  }

  /**
   * Request user input for a task variable. Returns the user's response or null if cancelled.
   */
  private requestInput(input: TaskInput, ctx: TaskVariableContext): Promise<string | null> {
    const requestId = randomUUID()
    const resolvedDescription = resolveVariables(input.description, ctx)

    return new Promise<string | null>((resolve) => {
      this.pendingInputResolvers.set(requestId, resolve)
      this.callbacks.onRequestInput({
        workspaceId: this.workspaceId,
        requestId,
        input,
        resolvedDescription,
      })
    })
  }

  /**
   * Handle a user's response to an input request.
   */
  provideInput(requestId: string, value: string | null): void {
    const resolver = this.pendingInputResolvers.get(requestId)
    if (resolver) {
      this.pendingInputResolvers.delete(requestId)
      resolver(value)
    }
  }

  getPendingInputCount(): number {
    return this.pendingInputResolvers.size
  }

  /**
   * Topological sort of task dependency graph. Returns ordered task IDs or throws on cycle.
   */
  private resolveDependencyOrder(taskId: string): string[] {
    const order: string[] = []
    const visited = new Set<string>()
    const inStack = new Set<string>()

    const visit = (id: string) => {
      if (visited.has(id)) return
      if (inStack.has(id)) throw new Error(`Circular dependency detected: ${id}`)

      inStack.add(id)
      const task = this.resolveTask(id)
      if (task?.dependsOn) {
        for (const dep of task.dependsOn) {
          visit(dep)
        }
      }
      inStack.delete(id)
      visited.add(id)
      order.push(id)
    }

    visit(taskId)
    return order
  }

  /**
   * Run a single task (no dependency resolution).
   */
  private async runSingle(
    task: AideTask,
    ctx: TaskVariableContext,
  ): Promise<TaskExecution> {
    task = this.applyDefaults(task)

    // Collect and resolve user inputs
    const inputIds = findInputReferences(task)
    if (inputIds.length > 0) {
      const inputs = this.getInputs()
      const resolvedInputs: Record<string, string> = { ...ctx.resolvedInputs }

      for (const inputId of inputIds) {
        if (resolvedInputs[inputId] !== undefined) continue
        const inputDef = inputs.find((i) => i.id === inputId)
        if (!inputDef) continue
        const value = await this.requestInput(inputDef, ctx)
        if (value === null) {
          // User cancelled
          const execution: TaskExecution = {
            workspaceId: this.workspaceId,
            executionId: randomUUID(),
            taskId: task.id,
            taskLabel: task.label,
            status: 'killed',
            startedAt: Date.now(),
            ptyId: '',
          }
          this.callbacks.onStatusChanged(execution)
          return execution
        }
        resolvedInputs[inputId] = value
      }
      ctx = { ...ctx, resolvedInputs }
    }

    // Resolve promptBefore
    if (task.promptBefore) {
      const resolvedPrompt = resolveVariables(task.promptBefore, ctx)
      const confirmInput: TaskInput = {
        id: '__confirm__',
        type: 'confirm',
        description: resolvedPrompt,
      }
      const confirmed = await this.requestInput(confirmInput, ctx)
      if (confirmed !== 'yes') {
        const execution: TaskExecution = {
          workspaceId: this.workspaceId,
          executionId: randomUUID(),
          taskId: task.id,
          taskLabel: task.label,
          status: 'killed',
          startedAt: Date.now(),
          ptyId: '',
        }
        this.callbacks.onStatusChanged(execution)
        return execution
      }
    }

    // Resolve command and args
    const resolvedCommand = resolveVariables(task.command, ctx)
    const resolvedArgs = task.args?.map((a) => resolveVariables(a, ctx)) ?? []
    const resolvedCwd = task.cwd
      ? resolve(ctx.workspaceRoot, resolveVariables(task.cwd, ctx))
      : ctx.workspaceRoot

    // Build environment
    const env: Record<string, string> = { ...process.env as Record<string, string> }
    if (task.env) {
      for (const [key, val] of Object.entries(task.env)) {
        env[key] = resolveVariables(val, ctx)
      }
    }

    // Load .env file if specified
    if (task.envFile) {
      const envFilePath = resolve(ctx.workspaceRoot, task.envFile)
      if (existsSync(envFilePath)) {
        try {
          const content = await readFile(envFilePath, 'utf-8')
          for (const line of content.split('\n')) {
            const trimmed = line.trim()
            if (!trimmed || trimmed.startsWith('#')) continue
            const eqIdx = trimmed.indexOf('=')
            if (eqIdx > 0) {
              const key = trimmed.slice(0, eqIdx).trim()
              let val = trimmed.slice(eqIdx + 1).trim()
              // Strip quotes
              if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1)
              }
              env[key] = val
            }
          }
        } catch {
          // Ignore env file read errors
        }
      }
    }

    // Determine shell
    const shell = task.shell || this.detectShell()
    const fullCommand = resolvedArgs.length > 0
      ? `${resolvedCommand} ${resolvedArgs.join(' ')}`
      : resolvedCommand

    // Spawn PTY
    const ptyId = randomUUID()
    const shellArgs = process.platform === 'win32' ? ['-c', fullCommand] : ['-lc', fullCommand]
    const pty = spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: existsSync(resolvedCwd) ? resolvedCwd : ctx.workspaceRoot,
      env,
    })

    const execution: TaskExecution = {
      workspaceId: this.workspaceId,
      executionId: randomUUID(),
      taskId: task.id,
      taskLabel: task.label,
      status: 'running',
      startedAt: Date.now(),
      ptyId,
      panelPolicy: task.presentation?.panel ?? 'shared',
      closeOnExit: task.presentation?.close ?? false,
    }

    // Set up problem matcher if configured
    const matchers = task.problemMatcher
      ? (Array.isArray(task.problemMatcher) ? task.problemMatcher : [task.problemMatcher])
      : []
    const matcherInstances = matchers
      .map((m) => createMatcher(m as BuiltinMatcherName))
      .filter((matcher): matcher is NonNullable<typeof matcher> => matcher !== null)
      .filter(Boolean)

    const runningTask: RunningTask = { execution, pty, task }

    // Data handler — forward to renderer and parse for diagnostics
    pty.onData((data) => {
      this.callbacks.onPtyData(ptyId, data)

      // Run problem matchers on each line
      if (matcherInstances.length > 0) {
        const lines = data.split('\n')
        const diagnostics: TaskDiagnostic[] = []
        for (const line of lines) {
          for (const matcher of matcherInstances) {
            const diag = matcher(line, task.id)
            if (diag) diagnostics.push(diag)
          }
        }
        if (diagnostics.length > 0) {
          this.callbacks.onDiagnostics(diagnostics)
        }
      }
    })

    // Exit handler
    pty.onExit(({ exitCode }) => {
      this.callbacks.onPtyExit(ptyId, exitCode)
      this.completedExitCodes.set(execution.executionId, exitCode)
      this.running.delete(execution.executionId)

      if (runningTask.timeoutTimer) {
        clearTimeout(runningTask.timeoutTimer)
      }

      if (execution.status === 'killed') {
        execution.exitCode = exitCode
        return
      }

      const finalStatus: TaskExecutionStatus = exitCode === 0 ? 'succeeded' : 'failed'
      execution.status = finalStatus
      execution.exitCode = exitCode
      this.callbacks.onStatusChanged({ ...execution })

      // Auto-restart background tasks that exit unexpectedly
      if (task.autoRestart && task.isBackground && exitCode !== 0) {
        setTimeout(() => {
          this.runSingle(task, ctx)
        }, 2000)
      }
    })

    this.running.set(execution.executionId, runningTask)
    this.callbacks.onStatusChanged({ ...execution })
    this.lastTaskId = task.id

    // Set up timeout
    if (task.timeout && task.timeout > 0) {
      runningTask.timeoutTimer = setTimeout(() => {
        this.kill(execution.executionId)
      }, task.timeout)
    }

    return execution
  }

  /**
   * Run a task with full dependency resolution.
   */
  async run(taskId: string, ctx: TaskVariableContext): Promise<TaskExecution | { error: string }> {
    // Check if it's a compound task
    const compound = this.getCompounds().find((c) => c.id === taskId)
    if (compound) {
      return this.runCompound(compound, ctx)
    }

    try {
      const order = this.resolveDependencyOrder(taskId)

      // Run dependencies sequentially first
      for (const depId of order.slice(0, -1)) {
        const depTask = this.resolveTask(depId)
        if (!depTask) return { error: `Dependency task not found: ${depId}` }

        const depExec = await this.runSingle(depTask, ctx)
        if (depExec.status === 'killed') {
          return { error: `Dependency "${depTask.label}" was cancelled` }
        }
        // Wait for dependency to complete
        if (depExec.ptyId) {
          const exitCode = await this.waitForCompletion(depExec.executionId)
          if (exitCode !== 0) {
            return { error: `Dependency "${depTask.label}" failed with exit code ${exitCode}` }
          }
        }
      }

      // Run the target task
      const task = this.resolveTask(taskId)
      if (!task) return { error: `Task not found: ${taskId}` }

      return this.runSingle(task, ctx)
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Unknown error' }
    }
  }

  /**
   * Run a compound task.
   */
  private async runCompound(
    compound: CompoundTask,
    ctx: TaskVariableContext,
  ): Promise<TaskExecution | { error: string }> {
    if (compound.mode === 'parallel') {
      const executions = await Promise.all(
        compound.tasks.map((taskId) => this.run(taskId, ctx)),
      )
      // Return first error or the first execution
      for (const exec of executions) {
        if ('error' in exec) return exec
      }
      return executions[0] as TaskExecution
    }

    // Sequential
    let lastExec: TaskExecution | { error: string } | null = null
    for (const taskId of compound.tasks) {
      lastExec = await this.run(taskId, ctx)
      if ('error' in lastExec) return lastExec
      if (lastExec.status === 'killed') {
        return { error: `Task "${lastExec.taskLabel}" was cancelled in sequence` }
      }

      // Wait for completion before next
      if (lastExec.ptyId) {
        const exitCode = await this.waitForCompletion(lastExec.executionId)
        if (exitCode !== 0) {
          return { error: `Task "${lastExec.taskLabel}" failed in sequence` }
        }
      }
    }
    return lastExec ?? { error: 'No tasks in compound' }
  }

  /**
   * Wait for a running task to complete. Returns exit code.
   */
  private waitForCompletion(executionId: string): Promise<number> {
    return new Promise<number>((resolve) => {
      const check = () => {
        const completed = this.completedExitCodes.get(executionId)
        if (completed !== undefined) {
          this.completedExitCodes.delete(executionId)
          resolve(completed)
          return
        }
        const running = this.running.get(executionId)
        if (!running) {
          resolve(1)
          return
        }
        if (running.execution.status !== 'running') {
          resolve(running.execution.exitCode ?? 1)
          return
        }
        setTimeout(check, 100)
      }
      check()
    })
  }

  /**
   * Kill a running task execution.
   */
  kill(executionId: string): void {
    const running = this.running.get(executionId)
    if (!running) return

    if (running.timeoutTimer) {
      clearTimeout(running.timeoutTimer)
    }

    running.pty.kill()
    running.execution.status = 'killed'
    this.running.delete(executionId)
    this.callbacks.onStatusChanged({ ...running.execution })
  }

  /**
   * Kill all running tasks.
   */
  killAll(): void {
    for (const [id] of this.running) {
      this.kill(id)
    }
  }

  /**
   * Get tasks that should auto-run on workspace open.
   */
  getWorkspaceOpenTasks(): AideTask[] {
    return this.getTasks().filter(
      (t) => t.runOn?.event === 'workspaceOpen',
    )
  }

  /**
   * Get tasks that should run on file save, matching the given file path.
   */
  getFileSaveTasks(filePath: string): AideTask[] {
    return this.getTasks().filter((t) => {
      if (t.runOn?.event !== 'fileSave') return false
      if (!t.runOn.filePattern) return true
      return this.matchGlob(t.runOn.filePattern, filePath)
    })
  }

  /**
   * Simple glob matching for file patterns.
   */
  private matchGlob(pattern: string, filePath: string): boolean {
    // Convert glob to regex
    const regexStr = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\{\{GLOBSTAR\}\}/g, '.*')
      .replace(/\{([^}]+)\}/g, (_m, group: string) => `(${group.split(',').join('|')})`)
    try {
      return new RegExp(`^${regexStr}$`).test(filePath)
    } catch {
      return false
    }
  }

  private detectShell(): string {
    if (process.platform === 'win32') return 'powershell.exe'
    return process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  }
}
