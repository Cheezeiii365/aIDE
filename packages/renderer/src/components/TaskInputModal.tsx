import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { TaskInputRequest } from '@aide/shared'

interface Props {
  request: TaskInputRequest
  onClose: () => void
}

/**
 * Render a modal prompting the user for task input and forward the chosen response to the main process.
 *
 * Supports `input.type` values:
 * - `text`: single-line text input (submit with Enter or OK).
 * - `pick`: select dropdown populated from `input.options`.
 * - `confirm`: simple yes/no confirmation.
 *
 * The component auto-focuses the first input control on mount. Dismissing via Cancel, overlay click, or Escape sends `null` for the request; confirming a `confirm` prompt sends `'yes'`; other submissions send the current input value. After sending the response it invokes `onClose`.
 *
 * @param request - TaskInputRequest containing `input`, `resolvedDescription`, and `requestId`.
 * @param onClose - Callback invoked after the modal is dismissed.
 * @returns The modal rendered as a React portal into `document.body`.
 */
export function TaskInputModal({ request, onClose }: Props) {
  const { input, resolvedDescription, requestId } = request
  const [value, setValue] = useState(input.default ?? '')
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.api.provideTaskInput(requestId, null)
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [requestId, onClose])

  const handleSubmit = () => {
    if (input.type === 'confirm') {
      window.api.provideTaskInput(requestId, 'yes')
    } else {
      window.api.provideTaskInput(requestId, value)
    }
    onClose()
  }

  const handleCancel = () => {
    window.api.provideTaskInput(requestId, null)
    onClose()
  }

  return createPortal(
    <div className="modal-overlay modal-overlay--animate" onClick={handleCancel}>
      <div
        className="modal modal--animate"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">Task Input</div>
        <div className="modal__body">
          <div className="modal__label">
            <span className="modal__label-text">{resolvedDescription}</span>

            {input.type === 'text' && (
              <input
                ref={inputRef as React.RefObject<HTMLInputElement>}
                className="modal__input"
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmit()
                }}
              />
            )}

            {input.type === 'pick' && input.options && (
              <select
                ref={inputRef as React.RefObject<HTMLSelectElement>}
                className="modal__select"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              >
                {input.options.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            )}
          </div>

          <div className="modal__actions">
            <button className="modal__btn modal__btn--secondary" onClick={handleCancel}>
              Cancel
            </button>
            {input.type === 'confirm' ? (
              <>
                <button className="modal__btn modal__btn--secondary" onClick={handleCancel}>
                  No
                </button>
                <button className="modal__btn modal__btn--primary" onClick={handleSubmit}>
                  Yes
                </button>
              </>
            ) : (
              <button className="modal__btn modal__btn--primary" onClick={handleSubmit}>
                OK
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
