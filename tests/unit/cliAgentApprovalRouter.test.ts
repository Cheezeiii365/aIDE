import { describe, it, expect, vi } from 'vitest'
import { ApprovalRouter, type ToolApprovalOwner } from '@main/chat/approvalRouter'

function makeOwner(ownedIds: string[]): ToolApprovalOwner & {
  approveCalls: Array<{ s: string; t: string }>
  rejectCalls: Array<{ s: string; t: string }>
} {
  const approveCalls: Array<{ s: string; t: string }> = []
  const rejectCalls: Array<{ s: string; t: string }> = []
  const owned = new Set(ownedIds)
  return {
    approveCalls,
    rejectCalls,
    ownsToolCall: (id: string) => owned.has(id),
    approveToolCall: (s: string, t: string) => approveCalls.push({ s, t }),
    rejectToolCall: (s: string, t: string) => rejectCalls.push({ s, t }),
    getPendingApprovalCount: () => owned.size,
  }
}

describe('ApprovalRouter', () => {
  it('routes approve to the owning manager', () => {
    const router = new ApprovalRouter()
    const a = makeOwner(['tc-1', 'tc-2'])
    const b = makeOwner(['tc-3'])
    router.register(a)
    router.register(b)

    const dispatched = router.approve('s-1', 'tc-3')
    expect(dispatched).toBe(true)
    expect(a.approveCalls).toEqual([])
    expect(b.approveCalls).toEqual([{ s: 's-1', t: 'tc-3' }])
  })

  it('routes reject to the owning manager', () => {
    const router = new ApprovalRouter()
    const a = makeOwner(['tc-1'])
    const b = makeOwner(['tc-2'])
    router.register(a)
    router.register(b)

    const dispatched = router.reject('s-1', 'tc-1')
    expect(dispatched).toBe(true)
    expect(a.rejectCalls).toEqual([{ s: 's-1', t: 'tc-1' }])
    expect(b.rejectCalls).toEqual([])
  })

  it('returns false when no owner claims the tool call', () => {
    const router = new ApprovalRouter()
    const a = makeOwner(['tc-1'])
    router.register(a)
    expect(router.approve('s-1', 'unknown')).toBe(false)
  })

  it('sums pending approvals across all owners', () => {
    const router = new ApprovalRouter()
    router.register(makeOwner(['a', 'b']))
    router.register(makeOwner(['c']))
    expect(router.getPendingApprovalCount()).toBe(3)
  })

  it('unregister removes an owner', () => {
    const router = new ApprovalRouter()
    const a = makeOwner(['tc-1'])
    router.register(a)
    router.unregister(a)
    expect(router.approve('s-1', 'tc-1')).toBe(false)
  })

  it('register is idempotent for the same owner', () => {
    const router = new ApprovalRouter()
    const a = makeOwner(['tc-1'])
    router.register(a)
    router.register(a)
    expect(router.getPendingApprovalCount()).toBe(1)
  })
})
