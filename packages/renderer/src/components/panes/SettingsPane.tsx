import { useState, useEffect } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { useSettings } from '../../hooks/useSettings'
import { useTheme } from '../../hooks/useTheme'
import { SETTINGS_CATEGORIES, getCategoriesWithSettings } from '../../lib/settingsSchema'
import { SettingsHeader } from '../settings/SettingsHeader'
import { SettingsCategorySidebar } from '../settings/SettingsCategorySidebar'
import { SettingsContent } from '../settings/SettingsContent'

interface SettingsPaneParams {
  zoomFactor?: number
}

export function SettingsPane({ params }: IDockviewPanelProps<SettingsPaneParams>) {
  const [settingsWorkspaceId, setSettingsWorkspaceId] = useState<string | null>(null)
  const settings = useSettings(settingsWorkspaceId)
  const { theme } = useTheme()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('textEditor.font')
  const [workspaceAvailable, setWorkspaceAvailable] = useState(false)

  useEffect(() => {
    const sync = (): void => {
      void window.api.getActiveWorkspaceId().then(setSettingsWorkspaceId)
    }
    sync()
    const unsub = window.api.onWorkspaceRegistryChanged(sync)
    return unsub
  }, [])

  useEffect(() => {
    if (!settingsWorkspaceId) {
      setWorkspaceAvailable(false)
      return
    }
    void window.api.getWorkspaceRoot(settingsWorkspaceId).then((root) => {
      setWorkspaceAvailable(root !== null)
    })
  }, [settingsWorkspaceId])

  const categoriesWithSettings = getCategoriesWithSettings()

  const handleThemeChange = (newTheme: 'one-dark' | 'one-light') => {
    window.api.setTheme(newTheme)
  }

  if (settings.loading) {
    return (
      <div className="settings-pane" style={{ zoom: params.zoomFactor ?? 1 }}>
        <div className="settings-placeholder settings-placeholder--centered">
          <p>Loading settings...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="settings-pane" style={{ zoom: params.zoomFactor ?? 1 }}>
      <SettingsHeader
        scope={settings.scope}
        onScopeChange={settings.setScope}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        workspaceAvailable={workspaceAvailable}
      />
      <div className="settings-body">
        <SettingsCategorySidebar
          categories={SETTINGS_CATEGORIES}
          activeCategory={activeCategory}
          onCategorySelect={setActiveCategory}
          categoriesWithSettings={categoriesWithSettings}
        />
        <SettingsContent
          settings={settings}
          activeCategory={activeCategory}
          searchQuery={searchQuery}
          theme={theme}
          onThemeChange={handleThemeChange}
        />
      </div>
    </div>
  )
}
