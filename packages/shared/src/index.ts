/**
 * Shared types and constants between main and renderer processes.
 * IPC channel definitions go here for type-safe communication.
 */

// IPC channel names — both main and renderer import these
// to ensure channel strings stay in sync.
export const IpcChannels = {
  // Window controls
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',

  // Theme
  THEME_GET: 'theme:get',
  THEME_SET: 'theme:set',
  THEME_CHANGED: 'theme:changed',
} as const

export type ThemeName = 'one-dark' | 'one-light'

export interface AppSettings {
  theme: ThemeName
  sidebarWidth: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'one-dark',
  sidebarWidth: 220,
}
