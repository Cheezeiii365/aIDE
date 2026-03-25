import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  onClose: () => void
}

export function CreateWorktreeModal({ onClose }: Props) {
  const [branchName, setBranchName] = useState('')
  const [createNew, setCreateNew] = useState(true)
  const [baseBranch, setBaseBranch] = useState('')
  const [existingBranches, setExistingBranches] = useState<string[]>([])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Load branches and focus input on mount
  useEffect(() => {
    window.api.listBranches().then((branches) => {
      setExistingBranches(branches)
      if (branches.length > 0) setBaseBranch(branches[0])
    })
    inputRef.current?.focus()
  }, [])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!branchName.trim()) return

    setError('')
    setSubmitting(true)

    const result = await window.api.createWorktree({
      branch: branchName.trim(),
      createBranch: createNew,
      baseBranch: createNew ? baseBranch || undefined : undefined,
    })

    setSubmitting(false)

    if ('error' in result) {
      setError(result.error)
    } else {
      onClose()
    }
  }

  return createPortal(
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">Create Worktree</div>
        <form className="modal__body" onSubmit={handleSubmit}>
          <label className="modal__label">
            <span className="modal__label-text">Branch name</span>
            <input
              ref={inputRef}
              className="modal__input"
              type="text"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder={createNew ? 'feature/my-branch' : 'Select existing branch'}
            />
          </label>

          <label className="modal__checkbox">
            <input
              type="checkbox"
              checked={createNew}
              onChange={(e) => setCreateNew(e.target.checked)}
            />
            <span>Create new branch</span>
          </label>

          {createNew && existingBranches.length > 0 && (
            <label className="modal__label">
              <span className="modal__label-text">Base branch</span>
              <select
                className="modal__select"
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
              >
                {existingBranches.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </label>
          )}

          {!createNew && (
            <label className="modal__label">
              <span className="modal__label-text">Existing branch</span>
              <select
                className="modal__select"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
              >
                <option value="">Select a branch...</option>
                {existingBranches.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </label>
          )}

          {error && <div className="modal__error">{error}</div>}

          <div className="modal__actions">
            <button type="button" className="modal__btn modal__btn--secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="modal__btn modal__btn--primary"
              disabled={!branchName.trim() || submitting}
            >
              {submitting ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
