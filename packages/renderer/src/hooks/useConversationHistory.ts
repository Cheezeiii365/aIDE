import { useState, useEffect, useCallback } from 'react'
import type {
  ConversationMeta,
  ConversationListChangedPayload,
  AgentBackend,
} from '@aide/shared'

export interface UseConversationHistoryReturn {
  conversations: ConversationMeta[]
  loading: boolean
  createConversation: (backend: AgentBackend, worktreePath?: string, worktreeBranch?: string) => Promise<ConversationMeta>
  deleteConversation: (id: string) => Promise<void>
  renameConversation: (id: string, title: string) => Promise<void>
}

export function useConversationHistory(workspaceId: string | undefined): UseConversationHistoryReturn {
  const [conversations, setConversations] = useState<ConversationMeta[]>([])
  const [loading, setLoading] = useState(true)

  // Load on mount / workspace change
  useEffect(() => {
    if (!workspaceId) {
      setConversations([])
      setLoading(false)
      return
    }
    let cancelled = false

    setLoading(true)
    window.api.conversationList(workspaceId).then((list) => {
      if (cancelled) return
      setConversations(list)
      setLoading(false)
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [workspaceId])

  // Subscribe to live updates
  useEffect(() => {
    const unsub = window.api.onConversationListChanged((payload: ConversationListChangedPayload) => {
      if (payload.workspaceId === workspaceId) {
        setConversations(payload.conversations)
      }
    })
    return unsub
  }, [workspaceId])

  const createConversation = useCallback(async (
    backend: AgentBackend,
    worktreePath?: string,
    worktreeBranch?: string,
  ): Promise<ConversationMeta> => {
    const meta = await window.api.conversationCreate({
      workspaceId: workspaceId!,
      backend,
      worktreePath,
      worktreeBranch,
    })
    return meta
  }, [workspaceId])

  const deleteConversation = useCallback(async (id: string) => {
    await window.api.conversationDelete(id)
  }, [])

  const renameConversation = useCallback(async (id: string, title: string) => {
    await window.api.conversationRename(id, title)
  }, [])

  return {
    conversations,
    loading,
    createConversation,
    deleteConversation,
    renameConversation,
  }
}
