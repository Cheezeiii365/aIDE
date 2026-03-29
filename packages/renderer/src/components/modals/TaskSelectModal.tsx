/**
 * @fileoverview Modal wrapper around `SearchPanel` for task-related commands (`task.run`, `task.terminate`).
 *
 * `AppShell` maps task or execution rows into `SearchPanelItem` and passes the chosen id to `runTask` or `killTask`.
 */

import { useMemo } from 'react'
import { SearchPanel, type SearchPanelItem } from '../layout/SearchPanel'

interface Props {
  /** Noun for the empty-state copy (`No matching ${title.toLowerCase()}`). */
  title: string
  /** Shown in the search field; defaults to “Filter…”. */
  placeholder?: string
  items: SearchPanelItem[]
  /** Receives the selected row’s `id` (task id or task execution id). */
  onSelect: (id: string) => void
  onClose: () => void
}

/**
 * Full-screen fuzzy picker opened from the command system; closes after selection or Escape (via `SearchPanel`).
 */
export function TaskSelectModal({ title, placeholder = 'Filter…', items, onSelect, onClose }: Props) {
  const panelItems = useMemo(() => items, [items])
  const emptyMessage = `No matching ${title.toLowerCase()}`

  return (
    <SearchPanel
      placeholder={placeholder}
      items={panelItems}
      onSelect={(item) => {
        onSelect(item.id)
        onClose()
      }}
      onClose={onClose}
      emptyMessage={emptyMessage}
    />
  )
}
