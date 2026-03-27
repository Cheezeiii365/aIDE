import type { SettingDescriptor } from '../../lib/settingsSchema'
import { SettingControl } from './SettingControl'

interface Props {
  descriptor: SettingDescriptor
  value: unknown
  isModified: boolean
  onChange: (value: unknown) => void
  onReset: () => void
}

export function SettingRow({ descriptor, value, isModified, onChange, onReset }: Props) {
  return (
    <div className={`settings-row ${isModified ? 'settings-row--modified' : ''}`}>
      <div className="settings-row__info">
        <div className="settings-row__label-line">
          {isModified && <span className="settings-row__modified-dot" title="Modified" />}
          <span className="settings-row__label">{descriptor.label}</span>
        </div>
        <span className="settings-row__description">{descriptor.description}</span>
      </div>
      <div className="settings-row__control">
        <SettingControl descriptor={descriptor} value={value} onChange={onChange} />
        {isModified && (
          <button
            className="settings-row__reset"
            onClick={onReset}
            title="Reset to default"
          >
            ↺
          </button>
        )}
      </div>
    </div>
  )
}
