import { useState, useEffect } from 'react'
import type { PermissionTier } from '@aide/shared'
import { Badge } from '../ui/Badge'

type BadgeVariant = 'warning' | 'info' | 'success'

const TIER_CONFIG: Record<PermissionTier, { label: string; icon: string; variant: BadgeVariant }> = {
  'confirm': { label: 'Confirm', icon: '⛨', variant: 'warning' },
  'auto-approve': { label: 'Auto', icon: '⚡', variant: 'info' },
  'autopilot': { label: 'Autopilot', icon: '◉', variant: 'success' },
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
    <Badge variant={config.variant} icon={config.icon} title={`Permission tier: ${config.label}`}>
      {config.label}
    </Badge>
  )
}
