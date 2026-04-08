import { useEffect, useRef, useMemo, useState, useCallback } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import type { AgentBackend, CliAgentMessage } from '@aide/shared'
import { useCliAgent } from '../../hooks/useCliAgent'
import { AgentStatusDot } from '../chat/AgentStatusDot'
import { ChatInput } from '../chat/ChatInput'
import { renderMarkdown } from '../../lib/markdownRenderer'
import { CLI_BACKENDS, backendBadgeLabel, backendLabel } from '../../lib/agentBackend'
import { CostTokenBadge } from '../cliAgent/CostTokenBadge'
import { RichPartRenderer, isRichPartType } from '../cliAgent/RichPartRenderer'
import { SessionMenu } from '../cliAgent/SessionMenu'
import { SessionSettingsPopover } from '../cliAgent/SessionSettingsPopover'
import '../../styles/cli-agent-pane.css'
import '../../styles/cli-agent-settings.css'

interface CliAgentPanelParams {
  workspaceId?: string
  workspaceRoot?: string
  backend?: AgentBackend
  conversationId?: string
  worktreePath?: string
  worktreeBranch?: string
  zoomFactor?: number
}

export function CliAgentPane({ params, api }: IDockviewPanelProps<CliAgentPanelParams>) {
  const { workspaceId, workspaceRoot, backend: backendParam, conversationId, worktreePath, zoomFactor } = params ?? {}
  const backend = backendParam ?? 'claude-code'
  const agent = useCliAgent({ workspaceId, backend, conversationId, worktreePath })
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
  const headerBackend: AgentBackend = agent.activeBackend ?? backend

  // Detect mixed-backend transcripts so we only render per-message badges when
  // the conversation actually contains output from more than one external CLI.
  const backendsSeen = useMemo(() => {
    const set = new Set<AgentBackend>()
    for (const m of agent.messages) {
      if (m.backend) set.add(m.backend)
    }
    return set
  }, [agent.messages])
  const showBackendBadges = backendsSeen.size > 1

  const handleBackendChange = async (next: AgentBackend) => {
    if (next === headerBackend) return
    if (isActive) return
    const ok = await agent.switchBackend(next)
    // Fall back to a fresh start() if the hot-swap IPC isn't wired in this build.
    if (!ok) await agent.start(next)
  }

  // Toast for session menu actions.
  const [toast, setToast] = useState<{ text: string; variant: 'success' | 'error' } | null>(null)
  const showToast = useCallback((text: string, variant: 'success' | 'error' = 'success') => {
    setToast({ text, variant })
    window.setTimeout(() => setToast(null), 3000)
  }, [])

  const handleRevertMessage = useCallback(
    async (messageId: string) => {
      if (!agent.sessionId) return
      const result = await window.api.cliAgentSessionRevert(agent.sessionId, messageId)
      if (result.error) showToast(result.error, 'error')
      else showToast('Reverted', 'success')
    },
    [agent.sessionId, showToast],
  )

  const isOpenCode = headerBackend === 'opencode'
  // Mirror the live per-backend state from the hook so the popover pickers
  // reflect any overrides the user has applied (and so dependent dropdowns
  // like the model picker re-render when the provider changes).
  const currentBackendState = isOpenCode
    ? (agent.backendState ?? { model: agent.model ?? undefined })
    : null

  return (
    <div className="cli-agent-pane" style={{ ['--panel-zoom' as string]: String(zoomFactor ?? 1) }}>
      {/* Header */}
      <div className="cli-agent-pane__header">
        <AgentStatusDot status={agent.processStatus} />
        <label
          className={`cli-agent-pane__backend-switcher cli-agent-pane__backend-switcher--${headerBackend}`}
          title={isActive ? 'Stop the active turn before switching backends' : 'Switch backend'}
        >
          <span className="cli-agent-pane__backend-label">
            {backendLabel(headerBackend)}
          </span>
          <span className="cli-agent-pane__backend-caret">{'\u25BE'}</span>
          <select
            className="cli-agent-pane__backend-select"
            value={headerBackend}
            disabled={isActive}
            onChange={(e) => { void handleBackendChange(e.target.value as AgentBackend) }}
          >
            {CLI_BACKENDS.map((b) => (
              <option key={b} value={b}>{backendLabel(b)}</option>
            ))}
          </select>
        </label>
        {agent.model && (
          <span className="cli-agent-pane__model">{agent.model}</span>
        )}
        <CostTokenBadge
          costUsd={agent.totalCostUsd}
          tokens={agent.totalTokens}
          compact
          hideCost={headerBackend === 'claude-code'}
        />
        <div className="cli-agent-pane__header-spacer" />
        {isOpenCode && agent.sessionId && currentBackendState && (
          <SessionSettingsPopover
            sessionId={agent.sessionId}
            state={currentBackendState}
            onPatch={agent.updateSessionConfig}
            disabled={isActive}
          />
        )}
        {isOpenCode && (
          <SessionMenu
            sessionId={agent.sessionId}
            disabled={isActive}
            onMessage={(text, variant) => showToast(text, variant ?? 'success')}
          />
        )}
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

      {toast && (
        <div
          style={{
            margin: '4px 8px',
            padding: '4px 8px',
            background:
              toast.variant === 'error'
                ? 'rgba(255,80,80,0.15)'
                : 'rgba(80,200,120,0.15)',
            color: toast.variant === 'error' ? 'tomato' : undefined,
            borderRadius: 4,
            fontSize: 11,
          }}
        >
          {toast.text}
        </div>
      )}

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
          <CliAgentMessageBubble
            key={msg.id}
            message={msg}
            showBackendBadge={showBackendBadges}
            onRevertMessage={isOpenCode ? handleRevertMessage : undefined}
          />
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

function CliAgentMessageBubble({
  message,
  showBackendBadge,
  onRevertMessage,
}: {
  message: CliAgentMessage
  showBackendBadge: boolean
  onRevertMessage?: (messageId: string) => void
}) {
  const badge =
    showBackendBadge && message.backend && message.type !== 'user' ? (
      <span
        className={`cli-agent-msg__backend-badge cli-agent-msg__backend-badge--${message.backend}`}
        title={`From ${backendLabel(message.backend)}`}
      >
        {backendBadgeLabel(message.backend)}
      </span>
    ) : null

  // Rich part types render via the dedicated component.
  if (isRichPartType(message.type)) {
    return <RichPartRenderer message={message} onRevertMessage={onRevertMessage} />
  }

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
        {badge}
      </div>
    )
  }

  if (message.type === 'tool_result') {
    return (
      <div className="cli-agent-msg cli-agent-msg--tool-result">
        {message.content}
        {badge}
      </div>
    )
  }

  if (message.type === 'system' || message.type === 'status') {
    return (
      <div className="cli-agent-msg cli-agent-msg--system">
        {message.content}
        {badge}
      </div>
    )
  }

  if (message.type === 'result') {
    return (
      <div className="cli-agent-msg cli-agent-msg--result">
        {message.content}
        {badge}
      </div>
    )
  }

  if (message.type === 'error') {
    return (
      <div className="cli-agent-msg cli-agent-msg--error">
        {message.content}
        {badge}
      </div>
    )
  }

  // Assistant
  return (
    <div className="cli-agent-msg cli-agent-msg--assistant">
      <CliAgentMarkdown content={message.content} />
      {badge}
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
