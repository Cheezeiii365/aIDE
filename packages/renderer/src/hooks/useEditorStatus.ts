import { createContext, useContext, useState, useCallback } from 'react'
import { createElement, type ReactNode } from 'react'

export interface EditorStatus {
  line: number
  col: number
  language: string
}

interface EditorStatusContextValue {
  status: EditorStatus
  setStatus: (status: EditorStatus) => void
}

const defaultStatus: EditorStatus = { line: 1, col: 1, language: 'Plain Text' }

const EditorStatusContext = createContext<EditorStatusContextValue | null>(null)

export function EditorStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatusState] = useState<EditorStatus>(defaultStatus)

  const setStatus = useCallback((next: EditorStatus) => {
    setStatusState(next)
  }, [])

  return createElement(
    EditorStatusContext.Provider,
    { value: { status, setStatus } },
    children,
  )
}

export function useEditorStatus(): EditorStatusContextValue {
  const ctx = useContext(EditorStatusContext)
  if (!ctx) throw new Error('useEditorStatus must be used within EditorStatusProvider')
  return ctx
}
