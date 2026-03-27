import type { SettingsScope } from '@aide/shared'

interface Props {
  scope: SettingsScope
  onScopeChange: (scope: SettingsScope) => void
  searchQuery: string
  onSearchChange: (query: string) => void
  workspaceAvailable: boolean
}

export function SettingsHeader({
  scope,
  onScopeChange,
  searchQuery,
  onSearchChange,
  workspaceAvailable,
}: Props) {
  return (
    <div className="settings-header">
      <div className="settings-header__tabs">
        <button
          className={`settings-header__tab ${scope === 'user' ? 'settings-header__tab--active' : ''}`}
          onClick={() => onScopeChange('user')}
        >
          User
        </button>
        <button
          className={`settings-header__tab ${scope === 'workspace' ? 'settings-header__tab--active' : ''}`}
          onClick={() => onScopeChange('workspace')}
          disabled={!workspaceAvailable}
          title={workspaceAvailable ? undefined : 'Open a workspace to edit workspace settings'}
        >
          Workspace
        </button>
      </div>
      <div className="settings-header__search">
        <input
          type="text"
          className="settings-header__search-input"
          placeholder="Search settings..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          autoFocus
        />
        {searchQuery && (
          <button
            className="settings-header__search-clear"
            onClick={() => onSearchChange('')}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}
