/**
 * ApprovalRouter — single approval surface for tool calls across both the
 * built-in `AgentManager` and the external `CliAgentManager`.
 *
 * The renderer talks to one channel pair (`CHAT_TOOL_APPROVE` /
 * `CHAT_TOOL_REJECT`) and one approval UI. The router decides which manager
 * actually owns the pending tool call (by id) and dispatches the user's
 * decision there.
 *
 * This keeps a single approval pane in the IDE for both backends, while
 * letting each manager keep its own pending-approval map and resolution
 * semantics.
 */

export interface ToolApprovalOwner {
  /** Returns true iff this owner is currently waiting on the given tool call id. */
  ownsToolCall(toolCallId: string): boolean
  approveToolCall(sessionId: string, toolCallId: string): void
  rejectToolCall(sessionId: string, toolCallId: string): void
  /** Number of approvals currently awaiting user decision (used by refreshWorkload). */
  getPendingApprovalCount(): number
}

export class ApprovalRouter {
  private owners: ToolApprovalOwner[] = []

  register(owner: ToolApprovalOwner): void {
    if (!this.owners.includes(owner)) {
      this.owners.push(owner)
    }
  }

  unregister(owner: ToolApprovalOwner): void {
    const idx = this.owners.indexOf(owner)
    if (idx >= 0) this.owners.splice(idx, 1)
  }

  approve(sessionId: string, toolCallId: string): boolean {
    for (const owner of this.owners) {
      if (owner.ownsToolCall(toolCallId)) {
        owner.approveToolCall(sessionId, toolCallId)
        return true
      }
    }
    return false
  }

  reject(sessionId: string, toolCallId: string): boolean {
    for (const owner of this.owners) {
      if (owner.ownsToolCall(toolCallId)) {
        owner.rejectToolCall(sessionId, toolCallId)
        return true
      }
    }
    return false
  }

  getPendingApprovalCount(): number {
    let total = 0
    for (const owner of this.owners) {
      total += owner.getPendingApprovalCount()
    }
    return total
  }
}
