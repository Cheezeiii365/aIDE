/**
 * @fileoverview Task runner commands: pick task, rerun last, terminate running, reload definitions.
 *
 * `task.run` / `task.terminate` open modals via context; execution uses `window.api` and `useTasks`-backed helpers on context.
 */

import { showToast } from '../../components/shared/Toast'
import type { GetCommandContext } from '../context'
import type { CommandSpec } from './types'

/**
 * @returns `task.*` command specs.
 */
export function collectTaskCommands(getCtx: GetCommandContext): CommandSpec[] {
  return [
    {
      def: { id: 'task.run', label: 'Run Task...', category: 'Task' },
      handler: () => {
        void (async () => {
          const wid = getCtx().getActiveWorkspaceId()
          if (!wid) {
            showToast('No active workspace')
            return
          }
          const { tasks, compounds } = await window.api.listTasks(wid)
          const allItems = [
            ...tasks.map((t) => ({ id: t.id, label: t.label, group: t.group })),
            ...compounds.map((c) => ({ id: c.id, label: c.label, group: undefined as string | undefined })),
          ]
          if (allItems.length === 0) {
            showToast('No tasks defined. Create .aide/tasks.json to add tasks.')
            return
          }
          getCtx().openTaskPicker(allItems)
        })()
      },
    },
    {
      def: { id: 'task.runLast', label: 'Run Last Task', category: 'Task' },
      handler: () => {
        const id = getCtx().getLastTaskId()
        if (!id) {
          showToast('No recent task to run')
          return
        }
        void getCtx().runTaskById(id)
      },
    },
    {
      def: { id: 'task.terminate', label: 'Terminate Task...', category: 'Task' },
      handler: () => {
        const running = getCtx().getRunningTasks().filter((e) => e.status === 'running')
        if (running.length === 0) {
          showToast('No running tasks')
          return
        }
        getCtx().openTerminateTaskPicker(running)
      },
    },
    {
      def: { id: 'task.reloadTasks', label: 'Reload Tasks', category: 'Task' },
      handler: () => {
        void (async () => {
          await getCtx().reloadTasksDefinitions()
          showToast('Tasks reloaded')
        })()
      },
    },
  ]
}
