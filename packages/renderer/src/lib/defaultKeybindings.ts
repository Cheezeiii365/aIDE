import type { KeybindingRule } from '@aide/shared'

/**
 * Default keybinding rules — single source of truth for all built-in key bindings.
 * Order matters: later entries with the same key override earlier ones (last match wins).
 */
export const defaultKeybindings: KeybindingRule[] = [
  // ── Editor ──────────────────────────────────────
  { key: 'Cmd+\\', command: 'editor.splitVertical' },
  { key: 'Cmd+Shift+\\', command: 'editor.splitHorizontal' },
  { key: 'Cmd+T', command: 'editor.symbolSearch' },

  // ── Workspace switching ─────────────────────────
  { key: 'Cmd+1', command: 'workspace.switchTo1' },
  { key: 'Cmd+2', command: 'workspace.switchTo2' },
  { key: 'Cmd+3', command: 'workspace.switchTo3' },
  { key: 'Cmd+4', command: 'workspace.switchTo4' },
  { key: 'Cmd+5', command: 'workspace.switchTo5' },
  { key: 'Cmd+6', command: 'workspace.switchTo6' },
  { key: 'Cmd+7', command: 'workspace.switchTo7' },
  { key: 'Cmd+8', command: 'workspace.switchTo8' },
  { key: 'Cmd+9', command: 'workspace.switchTo9' },

  // ── Workspace management ────────────────────────
  { key: 'Cmd+Shift+W', command: 'workspace.close' },
  { key: 'Cmd+Shift+N', command: 'workspace.new' },
  { key: 'Cmd+O', command: 'workspace.openFolder' },
  { key: 'Cmd+Shift+]', command: 'workspace.cycleTabNext' },
  { key: 'Cmd+Shift+[', command: 'workspace.cycleTabPrev' },

  // ── Tasks ───────────────────────────────────────
  { key: 'Cmd+Shift+B', command: 'task.run' },
  { key: 'Cmd+Shift+R', command: 'task.runLast' },
  { key: 'Cmd+Shift+X', command: 'task.terminate' },

  // ── Terminal ────────────────────────────────────
  { key: 'Cmd+Shift+T', command: 'terminal.new' },

  // ── View ────────────────────────────────────────
  { key: 'Cmd+B', command: 'view.toggleSidebar' },
  { key: 'Cmd+W', command: 'panel.close' },
  { key: 'Cmd+Shift+V', command: 'markdown.togglePreview' },
  { key: 'Cmd+Shift+P', command: 'commandPalette.open' },
  { key: 'Cmd+P', command: 'quickOpen.open' },
  { key: 'Cmd+Shift+F', command: 'search.findInFiles' },

  // ── Preferences ─────────────────────────────────
  { key: 'Cmd+,', command: 'settings.open' },
]
