import { useState, useEffect } from 'react'
import type { PermissionTier } from '@aide/shared'

const TIER_CONFIG: Record<PermissionTier, { label: string; icon: string; className: string }> = {
  'confirm': { label: 'Confirm', icon: '⛨', className: 'confirm' },
  'auto-approve': { label: 'Auto', icon: '⚡', className: 'auto' },
  'autopilot': { label: 'Autopilot', icon: '◉', className: 'autopilot' },
}

interface PermissionTierBadgeProps {
  /** When set, resolves permission tier for that workspace’s project settings cascade. */
  workspaceId?: string | null
}

export function PermissionTierBadge({ workspaceId }: PermissionTierBadgeProps) {
  const [tier, setTier] = useState<PermissionTier>('confirm')

  useEffect(() => {
    let cancelled = false

    async function load() {
      const wid = workspaceId ?? await window.api.getActiveWorkspaceId()
      if (cancelled || !wid) return
      const settings = await window.api.getResolvedSettings(wid)
      if (settings?.['agent.permissionTier']) {
        setTier(settings['agent.permissionTier'] as PermissionTier)
      }
    }

    void load()

    const unsub = window.api.onSettingsChanged(() => {
      void load()
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [workspaceId])

  const config = TIER_CONFIG[tier]

  return (
    <div className={`perm-tier-badge perm-tier-badge--${config.className}`} title={`Permission tier: ${config.label}`}>
      <span className="perm-tier-badge__icon">{config.icon}</span>
      <span className="perm-tier-badge__label">{config.label}</span>
    </div>
  )
}
