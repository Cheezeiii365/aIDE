import { useEffect, useRef } from 'react'
import type { WorkspaceEntry } from '@aide/shared'
import { showToast } from '../components/shared/Toast'
import {
  approvalInboxReplaceAll,
  approvalInboxUpsertFromToolCall,
} from '../lib/workspace/approvalInboxStore'
import {
  activityPushChatStreamEnd,
  activityPushCliResult,
  activityPushTask,
} from '../lib/workspace/runtimeActivityStore'

/**
 * Subscribes once to workspace-scoped runtime IPC and populates the global approval inbox
 * and activity feed. Shows toasts for notable background completions (non-active workspace).
 */
export function useRuntimeGlobalNotifications(
  workspaces: WorkspaceEntry[],
  activeWorkspaceId: string | null,
): void {
  const activeRef = useRef(activeWorkspaceId)
  activeRef.current = activeWorkspaceId

  const workspaceLabel = useRef((id: string) => {
    const w = workspaces.find((x) => x.id === id)
    return w?.name ?? id
  })
  workspaceLabel.current = (id: string) => {
    const w = workspaces.find((x) => x.id === id)
    return w?.name ?? id
  }

  useEffect(() => {
    let cancelled = false
    window.api.chatListPendingToolApprovals().then((list) => {
      if (!cancelled) approvalInboxReplaceAll(list)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const unChatTool = window.api.onChatToolCall((payload) => {
      approvalInboxUpsertFromToolCall(payload)

      const active = activeRef.current
      if (
        payload.toolCall.status === 'pending'
        && !payload.toolCall.autoApproved
        && payload.workspaceId !== active
      ) {
        const name = workspaceLabel.current(payload.workspaceId)
        showToast(`${name}: tool "${payload.toolCall.name}" needs approval`, {
          label: 'Review',
          onClick: () => {
            window.dispatchEvent(
              new CustomEvent('aide:open-runtime-inbox', { detail: { focusApprovalKey: keyOf(payload) } }),
            )
          },
        })
      }
    })

    const unStreamEnd = window.api.onChatStreamEnd((end) => {
      activityPushChatStreamEnd(end.workspaceId, end.sessionId, end.stopReason, end.error)
      const active = activeRef.current
      const name = workspaceLabel.current(end.workspaceId)
      if (end.workspaceId === active) return
      if (end.stopReason === 'error' || end.error) {
        showToast(`${name}: chat error — ${end.error ?? end.stopReason}`)
      } else if (end.stopReason === 'end_turn' || end.stopReason === 'stop') {
        showToast(`${name}: built-in agent finished`)
      }
    })

    const unCli = window.api.onCliAgentResult((r) => {
      activityPushCliResult(r.workspaceId, r.sessionId, r.isSuccess, r.totalCostUsd)
      const active = activeRef.current
      const name = workspaceLabel.current(r.workspaceId)
      if (r.workspaceId === active) return
      showToast(
        r.isSuccess
          ? `${name}: CLI agent completed${r.totalCostUsd !== undefined ? ` ($${r.totalCostUsd.toFixed(4)})` : ''}`
          : `${name}: CLI agent failed`,
      )
    })

    const unTask = window.api.onTaskStatusChanged((ex) => {
      activityPushTask(ex)
      const active = activeRef.current
      if (ex.workspaceId === active) return
      if (ex.status === 'failed' || ex.status === 'killed') {
        const name = workspaceLabel.current(ex.workspaceId)
        showToast(`${name}: task "${ex.taskLabel}" ${ex.status}`)
      } else if (ex.status === 'succeeded') {
        const name = workspaceLabel.current(ex.workspaceId)
        showToast(`${name}: task "${ex.taskLabel}" succeeded`)
      }
    })

    return () => {
      unChatTool()
      unStreamEnd()
      unCli()
      unTask()
    }
  }, [])
}

function keyOf(payload: { workspaceId: string; sessionId: string; toolCall: { id: string } }): string {
  return `${payload.workspaceId}:${payload.sessionId}:${payload.toolCall.id}`
}
