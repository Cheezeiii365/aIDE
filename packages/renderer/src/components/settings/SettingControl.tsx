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

    default:
      return null
  }
}
