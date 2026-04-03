/**
 * Factory that wraps an IPC listener callback so it only fires when the
 * payload's `workspaceId` matches the caller's workspace.  Eliminates the
 * repeated `if (!workspaceId || payload.workspaceId !== workspaceId) return`
 * guard across every renderer hook / component.
 *
 * Usage:
 *   window.api.onSomeEvent(scopedTo(workspaceId, (payload) => { … }))
 */
export function scopedTo<T extends { workspaceId: string | null }>(
  workspaceId: string | null | undefined,
  handler: (payload: T) => void,
): (payload: T) => void {
  return (payload: T) => {
    if (!workspaceId || payload.workspaceId !== workspaceId) return
    handler(payload)
  }
}
