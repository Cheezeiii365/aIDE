import type { TaskExecution } from '@aide/shared'

export type RuntimeActivityKind = 'agent_chat' | 'agent_cli' | 'task' | 'runtime'

export interface RuntimeActivityItem {
  id: string
  at: number
  kind: RuntimeActivityKind
  workspaceId: string
  summary: string
  detail?: string
}

const MAX_ITEMS = 40
const listeners = new Set<() => void>()
let items: RuntimeActivityItem[] = []

function emit(): void {
  for (const l of listeners) l()
}

export function getRuntimeActivitySnapshot(): RuntimeActivityItem[] {
  return items
}

export function subscribeRuntimeActivity(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
  }
}

function push(item: Omit<RuntimeActivityItem, 'id' | 'at'> & { id?: string }): void {
  const row: RuntimeActivityItem = {
    id: item.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    at: Date.now(),
    kind: item.kind,
    workspaceId: item.workspaceId,
    summary: item.summary,
    detail: item.detail,
  }
  items = [row, ...items].slice(0, MAX_ITEMS)
  emit()
}

export function activityPushChatStreamEnd(workspaceId: string, sessionId: string, stopReason: string, error?: string): void {
  if (stopReason === 'error' || error) {
    push({
      kind: 'agent_chat',
      workspaceId,
      summary: error ? `Chat error: ${error}` : 'Chat ended with error',
      detail: `session ${sessionId}`,
    })
    return
  }
  if (stopReason === 'end_turn' || stopReason === 'stop') {
    push({
      kind: 'agent_chat',
      workspaceId,
      summary: 'Built-in agent finished a turn',
      detail: `session ${sessionId}`,
    })
  }
}

export function activityPushCliResult(workspaceId: string, sessionId: string, isSuccess: boolean, cost?: number): void {
  const costBit = cost !== undefined ? ` · $${cost.toFixed(4)}` : ''
  push({
    kind: 'agent_cli',
    workspaceId,
    summary: isSuccess ? `CLI agent completed${costBit}` : `CLI agent failed${costBit}`,
    detail: `session ${sessionId}`,
  })
}

/** Test helper: clear feed. */
export function runtimeActivityClearForTests(): void {
  items = []
  emit()
}

export function activityPushTask(execution: TaskExecution): void {
  const { workspaceId, taskLabel, status, exitCode } = execution
  if (status === 'running') return
  const exitBit = exitCode !== undefined ? ` (exit ${exitCode})` : ''
  push({
    kind: 'task',
    workspaceId,
    summary:
      status === 'succeeded'
        ? `Task succeeded: ${taskLabel}${exitBit}`
        : `Task ${status}: ${taskLabel}${exitBit}`,
  })
}
