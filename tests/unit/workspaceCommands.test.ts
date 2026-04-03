import { describe, expect, it, vi } from 'vitest'
import type { CommandContext } from '@renderer/commands/context'
import { collectWorkspaceCommands } from '@renderer/commands/domains/workspace'

function stubContext(): CommandContext {
  return {
    getDockviewApi: () => null,
    getDockviewNavigation: () => null,
    getActiveWorkspaceId: () => null,
    getWorkspaceRoot: () => null,
    getActiveWorktreeRoot: () => null,
    getActiveBrowserPaneId: () => null,
    getWorkspaces: () => [],
    switchWorkspaceByIndex: vi.fn(),
    cycleWorkspace: vi.fn(),
    closeActiveWorkspace: vi.fn(),
    openFolder: vi.fn(),
    newBlankWorkspace: vi.fn(),
    toggleSidebar: vi.fn(),
    openCommandPalette: vi.fn(),
    openQuickOpen: vi.fn(),
    openNewBrowserModal: vi.fn(),
    persistWorkspaceRuntime: vi.fn(),
    presentGitignoreAudit: vi.fn(),
    openTaskPicker: vi.fn(),
    openTerminateTaskPicker: vi.fn(),
    runTaskById: vi.fn(),
    getLastTaskId: () => null,
    getRunningTasks: () => [],
    killTaskByExecutionId: vi.fn(),
    reloadTasksDefinitions: async () => {},
    toggleMarkdownPreview: vi.fn(),
  }
}

describe('workspace command definitions', () => {
  it('exports nine switch commands plus close, new, open folder, VS Code, and cycle', () => {
    const specs = collectWorkspaceCommands(stubContext)
    const ids = specs.map((s) => s.def.id)
    for (let n = 1; n <= 9; n++) {
      expect(ids).toContain(`workspace.switchTo${n}`)
    }
    expect(ids).toEqual(expect.arrayContaining([
      'workspace.close',
      'workspace.new',
      'workspace.openFolder',
      'workspace.openInVSCode',
      'workspace.cycleTabNext',
      'workspace.cycleTabPrev',
    ]))
    expect(ids).toHaveLength(15)
  })
})
