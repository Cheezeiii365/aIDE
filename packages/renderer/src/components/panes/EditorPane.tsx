import { useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { getLanguageExtension, getLanguageName } from '../../lib/languageExtension'
import { themeCompartment, getThemeExtension } from '../../lib/editorTheme'
import { getCachedState, setCachedState } from '../../lib/editorStateCache'
import { useEditorStatus } from '../../hooks/useEditorStatus'
import { useTheme } from '../../hooks/useTheme'

interface EditorPaneParams {
  filePath: string
}

export function EditorPane({ params, api }: IDockviewPanelProps<EditorPaneParams>) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const { theme } = useTheme()
  const { setStatus } = useEditorStatus()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const filePath = params.filePath

  // Create editor on mount
  useEffect(() => {
    if (!hostRef.current) return

    let destroyed = false

    async function init() {
      const result = await window.api.readFile(filePath)

      if (destroyed) return

      if ('error' in result) {
        setError(result.error)
        setLoading(false)
        return
      }

      const cached = getCachedState(filePath)
      const languageName = getLanguageName(filePath)

      let state: EditorState
      if (cached) {
        state = cached
      } else {
        const extensions = [
          basicSetup,
          themeCompartment.of(getThemeExtension(theme)),
          EditorView.updateListener.of((update) => {
            if (update.selectionSet || update.docChanged) {
              const pos = update.state.selection.main.head
              const line = update.state.doc.lineAt(pos)
              setStatus({
                line: line.number,
                col: pos - line.from + 1,
                language: languageName,
              })
            }
          }),
        ]

        const langExt = getLanguageExtension(filePath)
        if (langExt) extensions.push(langExt)

        state = EditorState.create({
          doc: result.content,
          extensions,
        })
      }

      if (destroyed || !hostRef.current) return

      const view = new EditorView({
        state,
        parent: hostRef.current,
      })

      viewRef.current = view
      setLoading(false)

      // Push initial cursor position
      const pos = state.selection.main.head
      const line = state.doc.lineAt(pos)
      setStatus({
        line: line.number,
        col: pos - line.from + 1,
        language: languageName,
      })
    }

    init()

    return () => {
      destroyed = true
      if (viewRef.current) {
        setCachedState(filePath, viewRef.current.state)
        viewRef.current.destroy()
        viewRef.current = null
      }
    }
  }, [filePath]) // eslint-disable-line react-hooks/exhaustive-deps

  // Hot-swap theme when it changes
  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      effects: themeCompartment.reconfigure(getThemeExtension(theme)),
    })
  }, [theme])

  // Push cursor status when this panel becomes active
  useEffect(() => {
    const disposable = api.onDidActiveChange(({ isActive }) => {
      if (isActive && viewRef.current) {
        const state = viewRef.current.state
        const pos = state.selection.main.head
        const line = state.doc.lineAt(pos)
        setStatus({
          line: line.number,
          col: pos - line.from + 1,
          language: getLanguageName(filePath),
        })
      }
    })
    return () => disposable.dispose()
  }, [api, filePath, setStatus])

  if (error) {
    return (
      <div className="editor-pane">
        <div className="editor-pane__error">{error}</div>
      </div>
    )
  }

  return (
    <div className="editor-pane">
      {loading && <div className="editor-pane__loading">Loading…</div>}
      <div
        ref={hostRef}
        className="editor-pane__cm-host"
        style={{ display: loading ? 'none' : 'block' }}
      />
    </div>
  )
}
