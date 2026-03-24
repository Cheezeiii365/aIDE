/// <reference types="vite/client" />

import type { WindowApi } from '@aide/shared'

declare global {
  interface Window {
    api: WindowApi
  }
}
