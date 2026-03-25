import { useState, useEffect, useCallback } from 'react'
import '../styles/toast.css'

interface ToastData {
  id: number
  message: string
  action?: { label: string; onClick: () => void }
}

let nextId = 0
let showToastFn: ((toast: Omit<ToastData, 'id'>) => void) | null = null

export function showToast(message: string, action?: ToastData['action']): void {
  showToastFn?.({ message, action })
}

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
          {t.action && (
            <button
              className="toast__action"
              onClick={(e) => {
                e.stopPropagation()
                t.action!.onClick()
                dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
