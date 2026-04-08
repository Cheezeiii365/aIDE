import { useMemo } from 'react'
import type { UseSettingsReturn } from '../../hooks/useSettings'
import {
  SETTINGS_CATEGORIES,
  SETTINGS_DESCRIPTORS,
  getDescriptorsForCategory,
  type SettingsCategory,
  type SettingDescriptor,
} from '../../lib/settingsSchema'
import { SettingRow } from './SettingRow'
import { KeyboardShortcutsTable } from './KeyboardShortcutsTable'
import { ToolPermissionsEditor } from './ToolPermissionsEditor'
import type { ThemeDefinition, ThemeId, ToolPermissionConfig } from '@aide/shared'

interface Props {
  settings: UseSettingsReturn
  activeCategory: string
  searchQuery: string
  themes: ThemeDefinition[]
  theme: ThemeDefinition
  activeThemeId: ThemeId
  defaultDarkThemeId: ThemeId
  defaultLightThemeId: ThemeId
  onThemeChange: (themeId: ThemeId) => void
  onDefaultDarkThemeChange: (themeId: ThemeId) => void
  onDefaultLightThemeChange: (themeId: ThemeId) => void
  onReloadThemes: () => void
  onOpenThemesDirectory: () => void
}

export function SettingsContent({
  settings,
  activeCategory,
  searchQuery,
  themes,
  theme,
  activeThemeId,
  defaultDarkThemeId,
  defaultLightThemeId,
  onThemeChange,
  onDefaultDarkThemeChange,
  onDefaultLightThemeChange,
  onReloadThemes,
  onOpenThemesDirectory,
}: Props) {
  const filteredSections = useMemo(() => {
    if (searchQuery) {
      return getSearchResults(searchQuery)
    }
    return getCategorySections(activeCategory)
  }, [activeCategory, searchQuery])
  const darkThemes = useMemo(() => themes.filter((entry) => entry.appearance === 'dark'), [themes])
  const lightThemes = useMemo(
    () => themes.filter((entry) => entry.appearance === 'light'),
    [themes],
  )

  return (
    <div className="settings-content">
      {filteredSections.map((section) => (
        <div key={section.categoryId} className="settings-section">
          <h2 className="settings-section__title">{section.label}</h2>

          {/* Special: Theme picker in Workbench > Appearance */}
          {section.categoryId === 'workbench.appearance' && (
            <>
              <div className="settings-row">
                <div className="settings-row__info">
                  <div className="settings-row__label-line">
                    <span className="settings-row__label">Color Theme</span>
                  </div>
                  <span className="settings-row__description">
                    Specifies the color theme used in the workbench.
                  </span>
                </div>
                <div className="settings-row__control">
                  <select
                    className="settings-input settings-input--select"
                    value={activeThemeId}
                    onChange={(e) => onThemeChange(e.target.value)}
                  >
                    {themes.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row__info">
                  <div className="settings-row__label-line">
                    <span className="settings-row__label">Default Dark Theme</span>
                  </div>
                  <span className="settings-row__description">
                    Used when the theme toggle switches into dark mode.
                  </span>
                </div>
                <div className="settings-row__control">
                  <select
                    className="settings-input settings-input--select"
                    value={defaultDarkThemeId}
                    onChange={(e) => onDefaultDarkThemeChange(e.target.value)}
                  >
                    {darkThemes.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row__info">
                  <div className="settings-row__label-line">
                    <span className="settings-row__label">Default Light Theme</span>
                  </div>
                  <span className="settings-row__description">
                    Used when the theme toggle switches into light mode.
                  </span>
                </div>
                <div className="settings-row__control">
                  <select
                    className="settings-input settings-input--select"
                    value={defaultLightThemeId}
                    onChange={(e) => onDefaultLightThemeChange(e.target.value)}
                  >
                    {lightThemes.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row__info">
                  <div className="settings-row__label-line">
                    <span className="settings-row__label">Installed Themes</span>
                  </div>
                  <span className="settings-row__description">
                    Themes load from your user themes folder. Current theme: {theme.label}.
                  </span>
                </div>
                <div className="settings-row__control">
                  <div className="settings-actions">
                    <button type="button" className="settings-button" onClick={onReloadThemes}>
                      Reload Themes
                    </button>
                    <button
                      type="button"
                      className="settings-button"
                      onClick={onOpenThemesDirectory}
                    >
                      Open Themes Folder
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Special: Keyboard Shortcuts table */}
          {section.categoryId === 'keyboardShortcuts' && <KeyboardShortcutsTable />}

          {/* Special: Per-tool permission overrides */}
          {section.categoryId === 'agent.permissions' && (
            <ToolPermissionsEditor
              value={
                (settings.getScopeValue('agent.autoApprove') as Record<
                  string,
                  boolean | ToolPermissionConfig
                >) ?? {}
              }
              onChange={(val) => settings.setValue('agent.autoApprove', val)}
            />
          )}

          {section.descriptors.length > 0
            ? section.descriptors.map((desc) => (
                <SettingRow
                  key={desc.key}
                  descriptor={desc}
                  value={settings.getScopeValue(desc.key)}
                  isModified={settings.isModified(desc.key)}
                  onChange={(value) => settings.setValue(desc.key, value)}
                  onReset={() => settings.resetToDefault(desc.key)}
                />
              ))
            : section.categoryId !== 'workbench.appearance' &&
              section.categoryId !== 'keyboardShortcuts' &&
              section.categoryId !== 'agent.permissions' && (
                <div className="settings-placeholder">
                  <p>No settings available yet.</p>
                </div>
              )}
        </div>
      ))}

      {filteredSections.length === 0 && (
        <div className="settings-placeholder settings-placeholder--centered">
          <p>{searchQuery ? 'No settings found.' : 'Select a category from the sidebar.'}</p>
        </div>
      )}
    </div>
  )
}

interface SectionData {
  categoryId: string
  label: string
  descriptors: SettingDescriptor[]
}

function getCategorySections(activeCategory: string): SectionData[] {
  // Find the active category in the tree
  const sections: SectionData[] = []

  function findCategory(categories: SettingsCategory[]): SettingsCategory | null {
    for (const cat of categories) {
      if (cat.id === activeCategory) return cat
      if (cat.children) {
        const found = findCategory(cat.children)
        if (found) return found
      }
    }
    return null
  }

  const active = findCategory(SETTINGS_CATEGORIES)
  if (!active) return sections

  if (active.children) {
    // Parent category — show all children
    for (const child of active.children) {
      sections.push({
        categoryId: child.id,
        label: child.label,
        descriptors: getDescriptorsForCategory(child.id),
      })
    }
  } else {
    // Leaf category
    sections.push({
      categoryId: active.id,
      label: active.label,
      descriptors: getDescriptorsForCategory(active.id),
    })
  }

  return sections
}

function getSearchResults(query: string): SectionData[] {
  const lower = query.toLowerCase()
  const matching = SETTINGS_DESCRIPTORS.filter(
    (d) =>
      d.label.toLowerCase().includes(lower) ||
      d.description.toLowerCase().includes(lower) ||
      d.key.toLowerCase().includes(lower),
  )

  // Group by category
  const groups = new Map<string, SettingDescriptor[]>()
  for (const desc of matching) {
    const existing = groups.get(desc.category)
    if (existing) {
      existing.push(desc)
    } else {
      groups.set(desc.category, [desc])
    }
  }

  const sections: SectionData[] = []
  for (const [catId, descriptors] of groups) {
    const label = findCategoryLabel(catId, SETTINGS_CATEGORIES) ?? catId
    sections.push({ categoryId: catId, label, descriptors })
  }

  return sections
}

function findCategoryLabel(id: string, categories: SettingsCategory[]): string | null {
  for (const cat of categories) {
    if (cat.id === id) return cat.label
    if (cat.children) {
      const found = findCategoryLabel(id, cat.children)
      if (found) return found
    }
  }
  return null
}
