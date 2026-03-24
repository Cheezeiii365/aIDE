/// <reference types="vite/client" />

import type { ThemeName } from '@aide/shared'

declare global {
  interface Window {
    api: {
      minimizeWindow: () => void
      maximizeWindow: () => void
      closeWindow: () => void
      getTheme: () => Promise<ThemeName>
      setTheme: (theme: ThemeName) => Promise<void>
      onThemeChanged: (callback: (theme: ThemeName) => void) => () => void
      onFullscreenChanged: (callback: (isFullscreen: boolean) => void) => () => void
      platform: NodeJS.Platform
    }
  }
}
