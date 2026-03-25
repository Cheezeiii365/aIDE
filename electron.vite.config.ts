import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import type { Plugin } from 'vite'

/** Strip dockview's runtime CSS injection so only our manual import is used. */
function stripDockviewStyleInject(): Plugin {
  return {
    name: 'strip-dockview-style-inject',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('dockview') && id.endsWith('.mjs') && code.includes('styleInject')) {
        return {
          code: code.replace(
            /function styleInject\(css, ref\) \{[\s\S]*?\n\}/,
            'function styleInject() {}',
          ),
          map: null,
        }
      }
      return null
    },
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ include: ['node-pty'] })],
    build: {
      outDir: 'packages/main/dist',
      lib: {
        entry: resolve(__dirname, 'packages/main/src/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'packages/main/dist/preload',
      lib: {
        entry: resolve(__dirname, 'packages/main/src/preload.ts'),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'packages/renderer'),
    plugins: [react(), stripDockviewStyleInject()],
    build: {
      outDir: resolve(__dirname, 'packages/renderer/dist'),
      rollupOptions: {
        input: resolve(__dirname, 'packages/renderer/index.html'),
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'packages/shared/src'),
        '@renderer': resolve(__dirname, 'packages/renderer/src'),
      },
    },
  },
})
