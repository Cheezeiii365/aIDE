import type { ChatMode } from '@aide/shared'
import { SegmentedControl } from '../ui/SegmentedControl'

interface ModeSelectorProps {
  mode: ChatMode
  onModeChange: (mode: ChatMode) => void
  disabled: boolean
}

const OPTIONS: { value: ChatMode; label: string }[] = [
  { value: 'ask', label: 'Ask' },
  { value: 'edit', label: 'Edit' },
  { value: 'agent', label: 'Agent' },
]

export function ModeSelector({ mode, onModeChange, disabled }: ModeSelectorProps) {
  return (
    <SegmentedControl
      options={OPTIONS}
      value={mode}
      onChange={onModeChange}
      disabled={disabled}
      ariaLabel="Chat mode"
    />
  )
}
