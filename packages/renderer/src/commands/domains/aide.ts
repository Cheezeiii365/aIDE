/**
 * @fileoverview aIDE project maintenance commands: `.aide` init, tasks.json generation, gitignore audit.
 *
 * Gitignore audit with findings routes through `presentGitignoreAudit` so the shell can show toast + modal.
 */

import { showToast } from '../../components/shared/Toast'
import type { GetCommandContext } from '../context'
import type { CommandSpec } from './types'

/**
 * @returns `aide.*` and `gitignore.audit` specs.
 */
export function collectAideCommands(getCtx: GetCommandContext): CommandSpec[] {
  return [
    {
      def: { id: 'aide.init', label: 'Initialize Project', category: 'aIDE' },
      handler: () => {
        void (async () => {
          const wid = getCtx().getActiveWorkspaceId()
          if (!wid) {
            showToast('No active workspace')
            return
          }
          const result = await window.api.aideInit(wid)
          if ('error' in result) {
            showToast(result.error)
          } else {
            showToast(result.created
              ? `Initialized .aide/ for ${result.projectType} project`
              : `Project already initialized (${result.projectType})`,
            )
          }
        })()
      },
    },
    {
      def: { id: 'aide.generateTasks', label: 'Generate Tasks', category: 'aIDE' },
      handler: () => {
        void (async () => {
          const wid = getCtx().getActiveWorkspaceId()
          if (!wid) {
            showToast('No active workspace')
            return
          }
          const result = await window.api.generateTasks(wid)
          if ('error' in result) {
            showToast(result.error)
          } else {
            showToast('Generated .aide/tasks.json')
          }
        })()
      },
    },
    {
      def: { id: 'gitignore.audit', label: 'Audit .gitignore Security', category: 'aIDE' },
      handler: () => {
        void (async () => {
          const wid = getCtx().getActiveWorkspaceId()
          if (!wid) {
            showToast('No active workspace')
            return
          }
          const result = await window.api.auditGitignore(wid)
          if (result.missing.length === 0) {
            showToast('All security patterns are present in .gitignore')
          } else {
            getCtx().presentGitignoreAudit(result)
          }
        })()
      },
    },
  ]
}
