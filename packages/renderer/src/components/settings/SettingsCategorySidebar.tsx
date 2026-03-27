import { useState } from 'react'
import type { SettingsCategory } from '../../lib/settingsSchema'

interface Props {
  categories: SettingsCategory[]
  activeCategory: string
  onCategorySelect: (categoryId: string) => void
  categoriesWithSettings: Set<string>
}

export function SettingsCategorySidebar({
  categories,
  activeCategory,
  onCategorySelect,
  categoriesWithSettings,
}: Props) {
  return (
    <nav className="settings-sidebar">
      {categories.map((cat) => (
        <CategoryItem
          key={cat.id}
          category={cat}
          activeCategory={activeCategory}
          onSelect={onCategorySelect}
          categoriesWithSettings={categoriesWithSettings}
          depth={0}
        />
      ))}
    </nav>
  )
}

interface CategoryItemProps {
  category: SettingsCategory
  activeCategory: string
  onSelect: (id: string) => void
  categoriesWithSettings: Set<string>
  depth: number
}

function CategoryItem({ category, activeCategory, onSelect, categoriesWithSettings, depth }: CategoryItemProps) {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = category.children && category.children.length > 0
  const isActive = activeCategory === category.id
  const isParentActive = hasChildren && category.children!.some(
    (c) => c.id === activeCategory,
  )

  // Check if this category or any children have settings
  const hasSettings = categoriesWithSettings.has(category.id) || (
    hasChildren && category.children!.some((c) => categoriesWithSettings.has(c.id))
  )

  return (
    <div className="settings-sidebar__item">
      <button
        className={`settings-sidebar__button ${isActive || isParentActive ? 'settings-sidebar__button--active' : ''} ${!hasSettings ? 'settings-sidebar__button--empty' : ''}`}
        style={{ paddingLeft: `${12 + depth * 12}px` }}
        onClick={() => {
          if (hasChildren) {
            setExpanded(!expanded)
            // Select first child if clicking parent
            if (!expanded && category.children![0]) {
              onSelect(category.children![0].id)
            }
          } else {
            onSelect(category.id)
          }
        }}
      >
        {hasChildren && (
          <span className={`settings-sidebar__chevron ${expanded ? 'settings-sidebar__chevron--expanded' : ''}`}>
            ›
          </span>
        )}
        <span className="settings-sidebar__label">{category.label}</span>
      </button>
      {hasChildren && expanded && (
        <div className="settings-sidebar__children">
          {category.children!.map((child) => (
            <CategoryItem
              key={child.id}
              category={child}
              activeCategory={activeCategory}
              onSelect={onSelect}
              categoriesWithSettings={categoriesWithSettings}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}
