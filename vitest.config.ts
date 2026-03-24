import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'packages/shared/src'),
      '@renderer': resolve(__dirname, 'packages/renderer/src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: [
      'packages/*/src/**/*.test.{ts,tsx}',
      'tests/unit/**/*.test.{ts,tsx}',
    ],
  },
})
