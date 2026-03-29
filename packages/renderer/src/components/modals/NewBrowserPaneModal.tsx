import { useEffect, useRef, useState } from 'react'
import type { BrowserSessionMode } from '@aide/shared'
import '../../styles/modal.css'

interface NewBrowserPaneModalProps {
  onClose: () => void
  onSubmit: (sessionMode: BrowserSessionMode, url: string) => void
}

/**
 * Render a modal that lets the user choose a session mode and starting URL to create a new browser pane.
 *
 * The modal autofocuses the starting URL input and closes when the Escape key is pressed or when the overlay is clicked.
 *
 * @param onClose - Callback invoked to close the modal
 * @param onSubmit - Callback invoked with the selected `sessionMode` and `url` when the form is submitted
 * @returns A React element representing the "New Browser Pane" modal
 */
export function NewBrowserPaneModal({ onClose, onSubmit }: NewBrowserPaneModalProps) {
  const [sessionMode, setSessionMode] = useState<BrowserSessionMode>('shared-auth')
  const [url, setUrl] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="modal-overlay modal-overlay--animate" onMouseDown={onClose}>
      <div className="modal modal--animate" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal__header">New Browser Pane</div>
        <form
          className="modal__body"
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit(sessionMode, url)
          }}
        >
          <label className="modal__label">
            <span className="modal__label-text">Session</span>
            <select
              className="modal__select"
              value={sessionMode}
              onChange={(event) => setSessionMode(event.target.value as BrowserSessionMode)}
            >
              <option value="shared-auth">Shared Auth</option>
              <option value="workspace">Workspace</option>
              <option value="temporary">Temporary</option>
            </select>
          </label>

          <label className="modal__label">
            <span className="modal__label-text">Starting URL</span>
            <input
              ref={inputRef}
              className="modal__input"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com"
              spellCheck={false}
            />
          </label>

          <div className="modal__actions">
            <button type="button" className="modal__btn modal__btn--secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="modal__btn modal__btn--primary">
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
