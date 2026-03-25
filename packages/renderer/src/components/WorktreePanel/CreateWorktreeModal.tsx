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
  const [success, setSuccess] = useState(false)
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
      setSuccess(true)
      setTimeout(onClose, 400)
    }
  }

  return createPortal(
    <div className="modal-overlay modal-overlay--animate" onMouseDown={onClose}>
      <div className="modal modal--animate" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">Create Worktree</div>
        <form className="modal__body" onSubmit={handleSubmit}>
          {/* Segmented toggle */}
          <div className="modal__toggle-group">
            <button
              type="button"
              className={`modal__toggle-btn${createNew ? ' modal__toggle-btn--active' : ''}`}
              onClick={() => setCreateNew(true)}
            >
              New Branch
            </button>
            <button
              type="button"
              className={`modal__toggle-btn${!createNew ? ' modal__toggle-btn--active' : ''}`}
              onClick={() => setCreateNew(false)}
            >
              Existing Branch
            </button>
          </div>

          {createNew ? (
            <div className="modal__field-group modal__field-group--animate" key="new">
              <label className="modal__label">
                <span className="modal__label-text">Branch name</span>
                <input
                  ref={inputRef}
                  className="modal__input"
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="feature/my-branch"
                />
              </label>

              {existingBranches.length > 0 && (
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
            </div>
          ) : (
            <div className="modal__field-group modal__field-group--animate" key="existing">
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
            </div>
          )}

          {error && <div className="modal__error">{error}</div>}

          <div className="modal__actions">
            <button type="button" className="modal__btn modal__btn--secondary" onClick={onClose}>
              Cancel
            </button>
            {success ? (
              <span className="modal__success">
                <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
                  <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
                </svg>
                Created!
              </span>
            ) : (
              <button
                type="submit"
                className="modal__btn modal__btn--primary"
                disabled={!branchName.trim() || submitting}
              >
                {submitting && <span className="modal__spinner" />}
                {submitting ? 'Creating...' : 'Create'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
