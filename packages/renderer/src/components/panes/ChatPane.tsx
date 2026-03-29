import { useEffect } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { useChat } from '../../hooks/useChat'
import { ModeSelector } from '../chat/ModeSelector'
import { PermissionTierBadge } from '../chat/PermissionTierBadge'
import { WorkingSetPicker } from '../chat/WorkingSetPicker'
import { MessageList } from '../chat/MessageList'
import { ChatInput } from '../chat/ChatInput'

interface ChatPanelParams {
  workspaceId?: string
  workspaceRoot?: string
  conversationId?: string
  zoomFactor?: number
}

export function ChatPane({ params, api }: IDockviewPanelProps<ChatPanelParams>) {
  const chat = useChat(params?.workspaceId, params?.conversationId)

  useEffect(() => {
    if (!chat.sessionId || params?.conversationId === chat.sessionId) return
    api.updateParameters({
      ...params,
      conversationId: chat.sessionId,
    })
  }, [api, chat.sessionId, params])

  // Auto-title the tab based on conversation title
  useEffect(() => {
    if (chat.conversationTitle && chat.conversationTitle !== 'New Chat') {
      api.setTitle(chat.conversationTitle)
    }
  }, [api, chat.conversationTitle])

  return (
    <div className="chat-pane" style={{ ['--panel-zoom' as string]: String(params?.zoomFactor ?? 1) }}>
      <div className="chat-pane__header">
        <div className="chat-pane__header-row">
          <ModeSelector
            mode={chat.mode}
            onModeChange={chat.setMode}
            disabled={chat.status !== 'idle'}
          />
          <PermissionTierBadge />
        </div>
        {chat.mode === 'edit' && (
          <WorkingSetPicker
            workingSet={chat.workingSet}
            onWorkingSetChange={chat.setWorkingSet}
            workspaceRoot={params?.workspaceRoot}
          />
        )}
      </div>

      <MessageList
        messages={chat.messages}
        streamingMessageId={chat.streamingMessageId}
        streamingContent={chat.streamingContent}
        status={chat.status}
        onApproveToolCall={chat.approveToolCall}
        onRejectToolCall={chat.rejectToolCall}
      />

      <div className="chat-pane__footer">
        <ChatInput
          onSend={chat.sendMessage}
          onStop={chat.stop}
          status={chat.status}
          mode={chat.mode}
        />
      </div>
    </div>
  )
}
