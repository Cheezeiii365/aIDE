/**
 * @fileoverview Agent UI commands: open a new agent tab (chat or CLI backend) and open chat history.
 *
 * Backend choice comes from resolved settings (`agent.backend`). Built-in chat creates a conversation via IPC first when possible.
 */

import type { ConversationMeta } from '@aide/shared'
import type { DockviewApi, IDockviewPanel } from 'dockview-react'
import type { CommandContext, GetCommandContext } from '../context'
import type { CommandSpec } from './types'

/**
 * Creates a `chatPane` with a server-issued `conversationId`, or falls back to a panel without id if create fails.
 */
function addBuiltInAgentPanel(
  ctx: CommandContext,
  api: DockviewApi,
  workspaceId: string,
  workspaceRoot: string | undefined,
  editorPanel: IDockviewPanel | undefined,
): void {
  void window.api.conversationCreate({
    workspaceId,
    backend: 'built-in',
  }).then((meta) => {
    api.addPanel({
      id: `agent-${Date.now()}`,
      component: 'chatPane',
      tabComponent: 'agentTab',
      title: 'Agent',
      params: {
        workspaceId,
        workspaceRoot,
        conversationId: meta.id,
      },
      position: editorPanel
        ? { referencePanel: editorPanel, direction: 'right' }
        : undefined,
      initialWidth: 350,
    })
    ctx.persistWorkspaceRuntime()
  }).catch(() => {
    api.addPanel({
      id: `agent-${Date.now()}`,
      component: 'chatPane',
      tabComponent: 'agentTab',
      title: 'Agent',
      params: { workspaceId, workspaceRoot },
      position: editorPanel
        ? { referencePanel: editorPanel, direction: 'right' }
        : undefined,
      initialWidth: 350,
    })
    ctx.persistWorkspaceRuntime()
  })
}

/**
 * @returns `agent.open` and `agent.history.open` specs.
 */
export function collectAgentCommands(getCtx: GetCommandContext): CommandSpec[] {
  return [
    {
      def: { id: 'agent.open', label: 'New Agent Tab', category: 'Agent' },
      handler: () => {
        const ctx = getCtx()
        const api = ctx.getDockviewApi()
        const workspaceId = ctx.getActiveWorkspaceId()
        if (!api || !workspaceId) return

        const workspaceRoot = ctx.getWorkspaceRoot() ?? undefined
        const editorPanel = api.panels.find(
          (p) => p.id === 'editor' || (p.params as Record<string, unknown> | undefined)?.filePath,
        )

        void window.api.getResolvedSettings(workspaceId).then((resolved) => {
          const backend = resolved['agent.backend'] ?? 'built-in'
          if (backend === 'claude-code' || backend === 'codex') {
            api.addPanel({
              id: `agent-${Date.now()}`,
              component: 'cliAgentPane',
              tabComponent: 'agentTab',
              title: backend === 'claude-code' ? 'Claude Code' : 'Codex',
              params: {
                workspaceId,
                workspaceRoot,
                backend,
                conversationId: crypto.randomUUID(),
              },
              position: editorPanel
                ? { referencePanel: editorPanel, direction: 'right' }
                : undefined,
              initialWidth: 400,
            })
            ctx.persistWorkspaceRuntime()
          } else {
            addBuiltInAgentPanel(ctx, api, workspaceId, workspaceRoot, editorPanel)
          }
        }).catch(() => {
          addBuiltInAgentPanel(ctx, api, workspaceId, workspaceRoot, editorPanel)
        })
      },
    },
    {
      def: { id: 'agent.history.open', label: 'Open Chat History', category: 'Agent' },
      handler: () => {
        const ctx = getCtx()
        const api = ctx.getDockviewApi()
        const workspaceId = ctx.getActiveWorkspaceId()
        if (!api || !workspaceId) return

        const workspaceRoot = ctx.getWorkspaceRoot() ?? undefined

        const onOpenConversation = (conv: ConversationMeta) => {
          api.addPanel({
            id: `agent-${Date.now()}`,
            component:
              conv.source === 'claude-native' || conv.backend === 'claude-code' || conv.backend === 'codex'
                ? 'cliAgentPane'
                : 'chatPane',
            tabComponent: 'agentTab',
            params: {
              workspaceId,
              workspaceRoot,
              backend: conv.backend,
              conversationId: conv.id,
              worktreePath: conv.worktreePath,
              worktreeBranch: conv.worktreeBranch,
            },
          })
        }

        const historyParams = {
          workspaceId,
          workspaceRoot,
          onOpenConversation,
        }

        const existing = api.panels.find((p) => p.id === 'agent-history')
        if (existing) {
          existing.api.updateParameters({ ...existing.params, ...historyParams })
          existing.api.setActive()
          return
        }

        api.addPanel({
          id: 'agent-history',
          component: 'chatHistoryPane',
          title: 'Chat History',
          params: historyParams,
        })
      },
    },
  ]
}
