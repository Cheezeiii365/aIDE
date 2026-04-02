import type { ChatToolCallPayload, PendingToolApprovalInfo } from '@aide/shared'

const listeners = new Set<() => void>()
let entries: PendingToolApprovalInfo[] = []

function key(e: Pick<PendingToolApprovalInfo, 'workspaceId' | 'sessionId'> & { toolCall: { id: string } }): string {
  return `${e.workspaceId}:${e.sessionId}:${e.toolCall.id}`
}

function emit(): void {
  for (const l of listeners) l()
}

export function getApprovalInboxSnapshot(): PendingToolApprovalInfo[] {
  return entries
}

export function subscribeApprovalInbox(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
  }
}

export function approvalInboxReplaceAll(fromMain: PendingToolApprovalInfo[]): void {
  entries = fromMain.map((e) => ({
    workspaceId: e.workspaceId,
    sessionId: e.sessionId,
    toolCall: { ...e.toolCall },
  }))
  emit()
}

export function approvalInboxUpsertFromToolCall(payload: ChatToolCallPayload): void {
  const { toolCall, workspaceId, sessionId } = payload
  if (toolCall.autoApproved) return
  if (toolCall.status !== 'pending') {
    approvalInboxRemove(workspaceId, sessionId, toolCall.id)
    return
  }
  const row: PendingToolApprovalInfo = {
    workspaceId,
    sessionId,
    toolCall: { ...toolCall },
  }
  const k = key(row)
  const idx = entries.findIndex(
    (e) => key(e) === k,
  )
  const next = [...entries]
  if (idx >= 0) next[idx] = row
  else next.push(row)
  entries = next
  emit()
}

export function approvalInboxRemove(workspaceId: string, sessionId: string, toolCallId: string): void {
  const k = `${workspaceId}:${sessionId}:${toolCallId}`
  const filtered = entries.filter((e) => key(e) !== k)
  if (filtered.length === entries.length) return
  entries = filtered
  emit()
}

export function approvalInboxPendingCount(): number {
  return entries.length
}
