import type { IDockviewPanelProps } from 'dockview-react'
import { useChat } from '../../hooks/useChat'
import { ModeSelector } from '../chat/ModeSelector'
import { WorkingSetPicker } from '../chat/WorkingSetPicker'
import { MessageList } from '../chat/MessageList'
import { ChatInput } from '../chat/ChatInput'

interface ChatPanelParams {
  workspaceId?: string
  workspaceRoot?: string
  zoomFactor?: number
}

export function ChatPane({ params }: IDockviewPanelProps<ChatPanelParams>) {
  const chat = useChat(params?.workspaceId)

  return (
    <div className="chat-pane" style={{ ['--panel-zoom' as string]: String(params?.zoomFactor ?? 1) }}>
      <div className="chat-pane__header">
        <ModeSelector
          mode={chat.mode}
          onModeChange={chat.setMode}
          disabled={chat.status !== 'idle'}
        />
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
