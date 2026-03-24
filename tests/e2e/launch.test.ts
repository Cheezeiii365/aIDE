import { test, expect } from '@playwright/test'
import { _electron as electron } from '@playwright/test'
import { resolve } from 'path'

const rootDir = resolve(__dirname, '../..')

test.describe('App launch', () => {
  test('opens a window with the correct title', async () => {
    const app = await electron.launch({
      args: [resolve(rootDir, 'packages/main/dist/index.js')],
      cwd: rootDir,
    })

    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const title = await window.title()
    expect(title).toBe('aIDE')

    await app.close()
  })

  test('renders the app shell content', async () => {
    const app = await electron.launch({
      args: [resolve(rootDir, 'packages/main/dist/index.js')],
      cwd: rootDir,
    })

    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await expect(window.locator('h1')).toHaveText('aIDE')
    await expect(window.locator('.app-shell')).toBeVisible()

    await app.close()
  })
})
