import { useState, useEffect, useCallback } from 'react'
import '../styles/toast.css'

interface ToastData {
  id: number
  message: string
  action?: { label: string; onClick: () => void }
}

let nextId = 0
let showToastFn: ((toast: Omit<ToastData, 'id'>) => void) | null = null

/**
 * Request showing a toast with the given message and optional action button.
 *
 * If no toast dispatcher is registered (for example, if ToastContainer is not mounted), the request is ignored.
 *
 * @param message - The message text to display in the toast
 * @param action - Optional action object; `label` is shown as a button and `onClick` is invoked when that button is pressed
 */
export function showToast(message: string, action?: ToastData['action']): void {
  showToastFn?.({ message, action })
}

/**
 * Registers a global toast dispatcher and renders a container of dismissible toasts.
 *
 * The component sets a module-level `showToastFn` on mount (cleared on unmount) so external code can enqueue toasts. Enqueued toasts automatically remove after 5 seconds, can be dismissed by clicking them, and may include an action button which invokes its callback and then dismisses the toast.
 *
 * @returns A JSX element containing active toasts, or `null` when there are none.
 */
export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastData[]>([])

  useEffect(() => {
    showToastFn = (toast) => {
      const id = nextId++
      setToasts((prev) => [...prev, { ...toast, id }])
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000)
    }
    return () => {
      showToastFn = null
    }
  }, [])

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className="toast" onClick={() => dismiss(t.id)}>
          <span>{t.message}</span>
          {(() => {
            const action = t.action
            if (!action) return null
            return (
            <button
              className="toast__action"
              onClick={(e) => {
                e.stopPropagation()
                action.onClick()
                dismiss(t.id)
              }}
            >
              {action.label}
            </button>
            )
          })()}
        </div>
      ))}
    </div>
  )
}
