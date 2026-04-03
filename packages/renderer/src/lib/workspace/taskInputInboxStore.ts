import type { TaskInputRequest } from '@aide/shared'

const listeners = new Set<() => void>()

let queue: TaskInputRequest[] = []

function key(r: Pick<TaskInputRequest, 'workspaceId' | 'requestId'>): string {
  return `${r.workspaceId}:${r.requestId}`
}

function emit(): void {
  for (const l of listeners) l()
}

export function subscribeTaskInputInbox(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
  }
}

export function taskInputInboxUpsert(request: TaskInputRequest): void {
  const k = key(request)
  const idx = queue.findIndex((r) => key(r) === k)
  const next = [...queue]
  if (idx >= 0) next[idx] = request
  else next.push(request)
  queue = next
  emit()
}

export function taskInputInboxRemove(workspaceId: string, requestId: string): void {
  const k = `${workspaceId}:${requestId}`
  const filtered = queue.filter((r) => key(r) !== k)
  if (filtered.length === queue.length) return
  queue = filtered
  emit()
}

/** Next pending input for the focused workspace (FIFO). */
export function getFirstPendingTaskInputForWorkspace(workspaceId: string): TaskInputRequest | null {
  return queue.find((r) => r.workspaceId === workspaceId) ?? null
}

/** Test helper */
export function taskInputInboxClearForTests(): void {
  queue = []
  emit()
}
