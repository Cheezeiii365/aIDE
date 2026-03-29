import { useState, useEffect } from 'react'
import type { PermissionTier } from '@aide/shared'

const TIER_CONFIG: Record<PermissionTier, { label: string; icon: string; className: string }> = {
  'confirm': { label: 'Confirm', icon: '⛨', className: 'confirm' },
  'auto-approve': { label: 'Auto', icon: '⚡', className: 'auto' },
  'autopilot': { label: 'Autopilot', icon: '◉', className: 'autopilot' },
}

export function PermissionTierBadge() {
  const [tier, setTier] = useState<PermissionTier>('confirm')

  useEffect(() => {
    window.api.getResolvedSettings().then((settings) => {
      if (settings?.['agent.permissionTier']) {
        setTier(settings['agent.permissionTier'] as PermissionTier)
      }
    })

    const unsub = window.api.onSettingsChanged((resolved) => {
      if (resolved?.['agent.permissionTier']) {
        setTier(resolved['agent.permissionTier'] as PermissionTier)
      }
    })
    return unsub
  }, [])

  const config = TIER_CONFIG[tier]

  return (
    <div className={`perm-tier-badge perm-tier-badge--${config.className}`} title={`Permission tier: ${config.label}`}>
      <span className="perm-tier-badge__icon">{config.icon}</span>
      <span className="perm-tier-badge__label">{config.label}</span>
    </div>
  )
}
