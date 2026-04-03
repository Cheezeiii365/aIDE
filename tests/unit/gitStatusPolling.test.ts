import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  startGitPollingForWorkspace,
  stopGitPollingForWorkspace,
  stopAllGitPolling,
} from '@main/git/gitStatus'

vi.mock('simple-git', () => ({
  default: () => ({
    checkIsRepo: vi.fn().mockResolvedValue(false),
    status: vi.fn(),
    raw: vi.fn(),
  }),
}))

describe('gitStatus multi-workspace polling', () => {
  afterEach(() => {
    stopAllGitPolling()
    vi.clearAllTimers()
  })

  it('starts independent poll handles per workspaceId', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const getWc = () => null

    await startGitPollingForWorkspace('ws-a', '/tmp/a', getWc)
    await startGitPollingForWorkspace('ws-b', '/tmp/b', getWc)

    const gitIntervals = setIntervalSpy.mock.calls.filter((c) => (c[1] as number) === 3000)
    expect(gitIntervals.length).toBe(2)

    stopGitPollingForWorkspace('ws-a')
    await startGitPollingForWorkspace('ws-a', '/tmp/a2', getWc)
    stopAllGitPolling()
    setIntervalSpy.mockRestore()
  })

  it('stopGitPollingForWorkspace is safe when unknown', () => {
    expect(() => stopGitPollingForWorkspace('no-such')).not.toThrow()
  })
})
