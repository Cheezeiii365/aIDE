import { useState } from 'react'
import type { SettingDescriptor } from '../../lib/settingsSchema'

interface Props {
  descriptor: SettingDescriptor
  value: unknown
  onChange: (value: unknown) => void
}

export function SettingControl({ descriptor, value, onChange }: Props) {
  switch (descriptor.type) {
    case 'boolean':
      return (
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="settings-toggle__slider" />
        </label>
      )

    case 'number':
      return (
        <input
          type="number"
          className="settings-input settings-input--number"
          value={value as number ?? ''}
          min={descriptor.min}
          max={descriptor.max}
          onChange={(e) => {
            const num = Number(e.target.value)
            if (!Number.isNaN(num)) onChange(num)
          }}
        />
      )

    case 'string':
      return (
        <input
          type="text"
          className="settings-input settings-input--text"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )

    case 'enum':
      return (
        <select
          className="settings-input settings-input--select"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          {descriptor.enumValues?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )

    case 'password':
      return <PasswordControl value={value} onChange={onChange} />

    default:
      return null
  }
}

function PasswordControl({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [revealed, setRevealed] = useState(false)
  const strValue = (value as string) ?? ''
  const isEnvRef = strValue.startsWith('${env:')

  return (
    <div className="settings-password">
      <input
        type={revealed ? 'text' : 'password'}
        className="settings-input settings-input--password"
        value={strValue}
        onChange={(e) => onChange(e.target.value)}
        placeholder="sk-... or ${env:ANTHROPIC_API_KEY}"
        spellCheck={false}
        autoComplete="off"
      />
      <button
        className="settings-password__toggle"
        onClick={() => setRevealed(!revealed)}
        title={revealed ? 'Hide' : 'Reveal'}
        type="button"
      >
        {revealed ? 'Hide' : 'Show'}
      </button>
      {isEnvRef && (
        <span className="settings-password__env-badge">ENV</span>
      )}
    </div>
  )
}
