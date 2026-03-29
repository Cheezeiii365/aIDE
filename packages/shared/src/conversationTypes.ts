/**
 * Conversation history types — shared between main and renderer.
 *
 * ConversationMeta is a lightweight index entry stored separately from
 * message data. Each conversation is bound to a workspace and optionally
 * to a specific worktree/branch for multi-agent workflows.
 */

import type { AgentBackend } from './cliAgentTypes'

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** Lightweight metadata stored in the conversation index. */
export interface ConversationMeta {
  id: string
  workspaceId: string
  backend: AgentBackend
  title: string
  /** False after manual rename — prevents auto-title from overwriting. */
  autoTitled: boolean
  createdAt: number
  updatedAt: number
  messageCount: number
  /** Truncated first user message for search/preview (~100 chars). */
  firstMessage?: string
  /** Claude Code session ID for --resume across sends. */
  claudeSessionId?: string
  /** Worktree path this conversation operates in. */
  worktreePath?: string
  /** Branch name for display (captured at creation, may become stale). */
  worktreeBranch?: string
  /**
   * When `'claude-native'`, entries are mirrored from `~/.claude/projects/<slug>/`
   * (Claude Code app) and are not persisted in `.aide/local/conversations/`.
   */
  source?: 'claude-native'
}

// ---------------------------------------------------------------------------
// IPC payloads
// ---------------------------------------------------------------------------

export interface ConversationCreateOpts {
  workspaceId: string
  backend: AgentBackend
  title?: string
  worktreePath?: string
  worktreeBranch?: string
}

export interface ConversationListChangedPayload {
  workspaceId: string
  conversations: ConversationMeta[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive a conversation title from the first user message content.
 * Truncates at word boundary around 40 chars.
 */
export function deriveTitle(content: string): string {
  const cleaned = content.trim().replace(/\n+/g, ' ')
  if (cleaned.length <= 40) return cleaned
  const truncated = cleaned.slice(0, 40)
  const lastSpace = truncated.lastIndexOf(' ')
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + '...'
}
