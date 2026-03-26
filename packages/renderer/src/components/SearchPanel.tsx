import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useVirtualizer } from '@tanstack/react-virtual'

// ── Types ──────────────────────────────────────

export interface SearchPanelItem {
  id: string
  label: string
  description?: string
  icon?: ReactNode
  category?: string
}

interface SearchPanelProps {
  placeholder: string
  items: SearchPanelItem[]
  onSelect: (item: SearchPanelItem) => void
  onClose: () => void
  renderItem?: (item: SearchPanelItem, isActive: boolean, highlights: number[]) => ReactNode
  emptyMessage?: string
}

// ── Fuzzy matching ─────────────────────────────

interface FuzzyResult {
  item: SearchPanelItem
  score: number
  indices: number[]
}

/**
 * Determines whether all characters of `query` appear in `text` in order and, if so, returns a match score and the positions of matched characters.
 *
 * @param query - The string of characters to match, in order.
 * @param text - The text to search for the query characters.
 * @returns `{ score, indices }` where `indices` are the character positions in `text` that match `query` and `score` reflects match quality; `null` if not all query characters are found in order.
 */
function fuzzyMatch(query: string, text: string): { score: number; indices: number[] } | null {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  const indices: number[] = []
  let qi = 0
  let score = 0
  let prevIdx = -1

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      indices.push(ti)
      // Bonus for consecutive matches
      score += prevIdx === ti - 1 ? 2 : 1
      // Bonus for matching at word boundaries
      if (ti === 0 || t[ti - 1] === ' ' || t[ti - 1] === '/' || t[ti - 1] === '.') {
        score += 3
      }
      prevIdx = ti
      qi++
    }
  }

  if (qi < q.length) return null // not all query chars matched
  return { score, indices }
}

/**
 * Filter items by fuzzy-matching their labels against the query and return matches ordered by relevance.
 *
 * @param items - The list of searchable items to evaluate.
 * @param query - The search query; when empty, all items are returned with `score: 0` and `indices: []`.
 * @returns An array of `FuzzyResult` objects for items whose labels match the query, sorted in descending order by `score`.
 */
function filterAndSort(items: SearchPanelItem[], query: string): FuzzyResult[] {
  if (!query) return items.map((item) => ({ item, score: 0, indices: [] }))

  const results: FuzzyResult[] = []
  for (const item of items) {
    const match = fuzzyMatch(query, item.label)
    if (match) results.push({ item, ...match })
  }
  results.sort((a, b) => b.score - a.score)
  return results
}

/**
 * Render a label with specific characters wrapped as highlights.
 *
 * When `indices` is non-empty, contiguous runs of characters whose positions are included
 * in `indices` are wrapped in `<mark>` elements; all other characters are wrapped in `<span>`.
 *
 * @param label - The text to render
 * @param indices - Array of character indices in `label` that should be highlighted
 * @returns A React fragment containing the label with highlighted segments
 */

function HighlightedLabel({ label, indices }: { label: string; indices: number[] }) {
  if (indices.length === 0) return <>{label}</>

  const indexSet = new Set(indices)
  const parts: ReactNode[] = []
  let run = ''
  let inHighlight = false

  for (let i = 0; i < label.length; i++) {
    const isMatch = indexSet.has(i)
    if (isMatch !== inHighlight) {
      if (run) {
        parts.push(
          inHighlight ? <mark key={i}>{run}</mark> : <span key={i}>{run}</span>,
        )
      }
      run = ''
      inHighlight = isMatch
    }
    run += label[i]
  }
  if (run) {
    parts.push(
      inHighlight ? <mark key="end">{run}</mark> : <span key="end">{run}</span>,
    )
  }
  return <>{parts}</>
}

/**
 * Renders an interactive, keyboard-navigable search overlay that filters and highlights items as the user types.
 *
 * The panel auto-focuses the input, performs fuzzy matching against item labels, virtualizes long result lists for performance, scrolls the active item into view, supports keyboard navigation (ArrowUp/ArrowDown, Enter to select, Escape to close), and closes when clicking outside the panel. The overlay is rendered into `document.body` via a portal.
 *
 * @param placeholder - Placeholder text displayed in the search input
 * @param items - Array of searchable items shown in the panel
 * @param onSelect - Called with the selected item when the user activates an item (click or Enter)
 * @param onClose - Called when the panel should close (Escape key or click outside)
 * @param renderItem - Optional renderer to customize an item's content; receives `(item, isActive, highlights)`
 * @param emptyMessage - Message shown when no results match the query
 * @returns The rendered search panel React element
 */

export function SearchPanel({
  placeholder,
  items,
  onSelect,
  onClose,
  renderItem,
  emptyMessage = 'No results found',
}: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => filterAndSort(items, query), [items, query])

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(0)
  }, [results.length])

  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 32,
    overscan: 8,
  })

  // Scroll active item into view
  useEffect(() => {
    virtualizer.scrollToIndex(activeIndex, { align: 'auto' })
  }, [activeIndex, virtualizer])

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setActiveIndex((i) => Math.min(i + 1, results.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setActiveIndex((i) => Math.max(i - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (results[activeIndex]) onSelect(results[activeIndex].item)
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    },
    [results, activeIndex, onSelect, onClose],
  )

  // Click-outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const panel = document.querySelector('.search-panel')
      if (panel && !panel.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return createPortal(
    <div className="search-panel-overlay">
      <div className="search-panel" onKeyDown={handleKeyDown}>
        <input
          ref={inputRef}
          className="search-panel__input"
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <div ref={listRef} className="search-panel__list">
          {results.length === 0 ? (
            <div className="search-panel__empty">{emptyMessage}</div>
          ) : (
            <div
              style={{
                height: virtualizer.getTotalSize(),
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((vItem) => {
                const { item, indices } = results[vItem.index]
                const isActive = vItem.index === activeIndex

                return (
                  <div
                    key={item.id}
                    className={`search-panel__item${isActive ? ' search-panel__item--active' : ''}`}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: vItem.size,
                      transform: `translateY(${vItem.start}px)`,
                    }}
                    onClick={() => onSelect(item)}
                    onMouseEnter={() => setActiveIndex(vItem.index)}
                  >
                    {renderItem ? (
                      renderItem(item, isActive, indices)
                    ) : (
                      <>
                        {item.icon && (
                          <span className="search-panel__icon">{item.icon}</span>
                        )}
                        <span className="search-panel__label">
                          <HighlightedLabel label={item.label} indices={indices} />
                        </span>
                        {item.description && (
                          <span className="search-panel__description">
                            {item.description}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
