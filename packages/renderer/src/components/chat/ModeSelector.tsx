import type { ChatMode } from '@aide/shared'

interface ModeSelectorProps {
  mode: ChatMode
  onModeChange: (mode: ChatMode) => void
  disabled: boolean
}

const MODES: { value: ChatMode; label: string }[] = [
  { value: 'ask', label: 'ASK' },
  { value: 'edit', label: 'EDIT' },
  { value: 'agent', label: 'AGENT' },
]

export function ModeSelector({ mode, onModeChange, disabled }: ModeSelectorProps) {
  return (
    <div className={`chat-mode-selector${disabled ? ' chat-mode-selector--disabled' : ''}`}>
      {MODES.map((m) => (
        <button
          key={m.value}
          className={`chat-mode-selector__btn${m.value === mode ? ' chat-mode-selector__btn--active' : ''}`}
          onClick={() => onModeChange(m.value)}
          disabled={disabled}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
