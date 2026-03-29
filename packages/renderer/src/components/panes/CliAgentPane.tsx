import { useEffect, useRef, useMemo } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import type { AgentBackend, CliAgentMessage } from '@aide/shared'
import { useCliAgent } from '../../hooks/useCliAgent'
import { AgentStatusDot } from '../chat/AgentStatusDot'
import { ChatInput } from '../chat/ChatInput'
import { renderMarkdown } from '../../lib/markdownRenderer'
import '../../styles/cli-agent-pane.css'

interface CliAgentPanelParams {
  workspaceId?: string
  workspaceRoot?: string
  backend?: AgentBackend
  conversationId?: string
  zoomFactor?: number
}

export function CliAgentPane({ params, api }: IDockviewPanelProps<CliAgentPanelParams>) {
  const { workspaceId, workspaceRoot, backend: backendParam, conversationId, zoomFactor } = params ?? {}
  const backend = backendParam ?? 'claude-code'
  const agent = useCliAgent({ workspaceId, backend, conversationId })
  const listRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const hasAutoStartedRef = useRef(false)

  useEffect(() => {
    hasAutoStartedRef.current = false
  }, [workspaceId, conversationId])

  // Auto-title the tab based on conversation title
  useEffect(() => {
    if (agent.conversationTitle && agent.conversationTitle !== 'New Chat') {
      api.setTitle(agent.conversationTitle)
    }
  }, [api, agent.conversationTitle])

  // Auto-create session on mount (no process yet — first send() spawns it)
  useEffect(() => {
    if (
      workspaceId &&
      agent.historyHydrated &&
      agent.processStatus === 'stopped' &&
      !hasAutoStartedRef.current &&
      !agent.lastError &&
      (conversationId || agent.messages.length === 0)
    ) {
      hasAutoStartedRef.current = true
      void agent.start(backend)
    }
  }, [
    workspaceId,
    conversationId,
    agent.historyHydrated,
    agent.processStatus,
    agent.lastError,
    agent.messages.length,
    agent.start,
    backend,
  ])

  // Auto-scroll
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    if (isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [agent.messages.length, agent.streamingContent])

  const handleScroll = () => {
    const el = listRef.current
    if (!el) return
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  const isActive = agent.processStatus === 'running' || agent.processStatus === 'starting' || agent.processStatus === 'rate_limited'

  return (
    <div className="cli-agent-pane" style={{ ['--panel-zoom' as string]: String(zoomFactor ?? 1) }}>
      {/* Header */}
      <div className="cli-agent-pane__header">
        <AgentStatusDot status={agent.processStatus} />
        <span className="cli-agent-pane__backend-label">
          {backend === 'claude-code' ? 'Claude Code' : 'Codex'}
        </span>
        {agent.model && (
          <span className="cli-agent-pane__model">{agent.model}</span>
        )}
        <div className="cli-agent-pane__header-spacer" />
        {isActive ? (
          <button className="cli-agent-pane__btn cli-agent-pane__btn--stop" onClick={agent.stop}>
            Stop
          </button>
        ) : (
          <button
            className="cli-agent-pane__btn cli-agent-pane__btn--start"
            onClick={() => agent.start(backend)}
          >
            {agent.processStatus === 'error' ? 'Restart' : 'Start'}
          </button>
        )}
      </div>

      {/* Error banner */}
      {agent.lastError && agent.processStatus === 'error' && (
        <div className="cli-agent-pane__error-banner">
          <span className="cli-agent-pane__error-icon">!</span>
          <span className="cli-agent-pane__error-text">{agent.lastError}</span>
        </div>
      )}

      {/* Message list */}
      <div className="cli-agent-pane__messages" ref={listRef} onScroll={handleScroll}>
        {agent.messages.length === 0 && !agent.streamingContent && (
          <div className="cli-agent-pane__empty">
            {isActive
              ? 'Waiting for response...'
              : 'Send a message to start the agent'}
          </div>
        )}

        {agent.messages.map((msg) => (
          <CliAgentMessageBubble key={msg.id} message={msg} />
        ))}

        {agent.streamingContent && (
          <div className="cli-agent-msg cli-agent-msg--assistant">
            <CliAgentMarkdown content={agent.streamingContent} />
            <span className="cli-agent-msg__cursor">{'\u2588'}</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="cli-agent-pane__footer">
        <ChatInput
          onSend={agent.send}
          onStop={agent.stop}
          status={isActive ? 'thinking' : 'idle'}
          mode="agent"
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CliAgentMessageBubble({ message }: { message: CliAgentMessage }) {
  if (message.type === 'user') {
    return (
      <div className="cli-agent-msg cli-agent-msg--user">
        <span className="cli-agent-msg__prefix">&gt;</span>
        <div className="cli-agent-msg__body">{message.content}</div>
      </div>
    )
  }

  if (message.type === 'tool_use') {
    return (
      <div className="cli-agent-msg cli-agent-msg--tool">
        <span className="cli-agent-msg__tool-icon">&#x25B6;</span>
        <span className="cli-agent-msg__tool-name">{message.toolName ?? 'tool'}</span>
        <span className="cli-agent-msg__tool-text">{message.content}</span>
      </div>
    )
  }

  if (message.type === 'tool_result') {
    return (
      <div className="cli-agent-msg cli-agent-msg--tool-result">
        {message.content}
      </div>
    )
  }

  if (message.type === 'system' || message.type === 'status') {
    return (
      <div className="cli-agent-msg cli-agent-msg--system">
        {message.content}
      </div>
    )
  }

  if (message.type === 'result') {
    return (
      <div className="cli-agent-msg cli-agent-msg--result">
        {message.content}
      </div>
    )
  }

  if (message.type === 'error') {
    return (
      <div className="cli-agent-msg cli-agent-msg--error">
        {message.content}
      </div>
    )
  }

  // Assistant
  return (
    <div className="cli-agent-msg cli-agent-msg--assistant">
      <CliAgentMarkdown content={message.content} />
    </div>
  )
}

function CliAgentMarkdown({ content }: { content: string }) {
  const html = useMemo(() => {
    if (!content) return ''
    return renderMarkdown(content)
  }, [content])

  return <span dangerouslySetInnerHTML={{ __html: html }} />
}
