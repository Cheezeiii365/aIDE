import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { GitignoreAuditResult } from '@aide/shared'

interface Props {
  auditResult: GitignoreAuditResult
  onClose: () => void
}

/**
 * Render a modal that lets the user review missing `.gitignore` security patterns and choose which to add.
 *
 * The modal groups patterns by category, supports individual toggles and a "Select all" checkbox (with indeterminate state),
 * calls `window.api.appendToGitignore` with selected patterns when confirming, and calls `window.api.dismissGitignoreAudit` when dismissing.
 * The modal closes when the overlay is clicked, when the Escape key is pressed, or after add/dismiss actions.
 *
 * @param auditResult - Object containing `missing` pattern entries to display (each entry has `pattern` and `category`).
 * @param onClose - Callback invoked when the modal should be closed.
 * @returns The portal-mounted modal element rendered into `document.body`.
 */
export function GitignoreReviewModal({ auditResult, onClose }: Props) {
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(auditResult.missing.map((m) => m.pattern)),
  )
  const [submitting, setSubmitting] = useState(false)

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const togglePattern = useCallback((pattern: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(pattern)) {
        next.delete(pattern)
      } else {
        next.add(pattern)
      }
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setChecked((prev) => {
      if (prev.size === auditResult.missing.length) {
        return new Set()
      }
      return new Set(auditResult.missing.map((m) => m.pattern))
    })
  }, [auditResult.missing])

  const handleAdd = useCallback(async () => {
    const patterns = Array.from(checked)
    if (patterns.length === 0) return
    setSubmitting(true)
    try {
      await window.api.appendToGitignore(patterns)
      onClose()
    } catch {
      setSubmitting(false)
    }
  }, [checked, onClose])

  const handleDismiss = useCallback(async () => {
    await window.api.dismissGitignoreAudit()
    onClose()
  }, [onClose])

  // Group missing patterns by category
  const grouped = new Map<string, { pattern: string; category: string }[]>()
  for (const item of auditResult.missing) {
    const group = grouped.get(item.category) ?? []
    group.push(item)
    grouped.set(item.category, group)
  }

  return createPortal(
    <div className="modal-overlay modal-overlay--animate" onClick={onClose}>
      <div
        className="modal modal--animate"
        style={{ maxWidth: 520, maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">.gitignore Security Audit</div>
        <div className="gitignore-modal__description">
          Found {auditResult.missing.length} missing pattern{auditResult.missing.length !== 1 ? 's' : ''} for sensitive files.
          Select which patterns to add to your .gitignore.
        </div>
        <div className="gitignore-modal__list">
          <label className="gitignore-modal__select-all">
            <input
              type="checkbox"
              checked={checked.size === auditResult.missing.length}
              ref={(el) => {
                if (el) el.indeterminate = checked.size > 0 && checked.size < auditResult.missing.length
              }}
              onChange={toggleAll}
            />
            <span>Select all</span>
          </label>
          {Array.from(grouped.entries()).map(([category, items]) => (
            <div key={category} className="gitignore-modal__group">
              <div className="gitignore-modal__category">{category}</div>
              {items.map((item) => (
                <label key={item.pattern} className="gitignore-modal__item">
                  <input
                    type="checkbox"
                    checked={checked.has(item.pattern)}
                    onChange={() => togglePattern(item.pattern)}
                  />
                  <code>{item.pattern}</code>
                </label>
              ))}
            </div>
          ))}
        </div>
        <div className="modal__actions" style={{ padding: '12px 16px', borderTop: '1px solid var(--border-subtle)' }}>
          <button className="modal__btn modal__btn--secondary" onClick={handleDismiss}>
            Don't show again
          </button>
          <button
            className="modal__btn modal__btn--primary"
            onClick={handleAdd}
            disabled={checked.size === 0 || submitting}
          >
            {submitting ? <span className="modal__spinner" /> : null}
            Add {checked.size} pattern{checked.size !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
