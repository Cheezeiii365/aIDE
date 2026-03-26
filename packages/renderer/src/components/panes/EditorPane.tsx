import { useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { indentationMarkers } from '@replit/codemirror-indentation-markers'
import { getLanguageExtension, getLanguageName } from '../../lib/languageExtension'
import { themeCompartment, getThemeExtension } from '../../lib/editorTheme'
import { wrapCompartment, getWrapExtension, toggleWrap } from '../../lib/editorWrap'
import { getCachedState, setCachedState } from '../../lib/editorStateCache'
import { isDirty, setDirty, onDirtyChange } from '../../lib/editorDirtyState'
import { publishContent, clearContent } from '../../lib/editorContentBus'
import { useEditorStatus } from '../../hooks/useEditorStatus'
import { useTheme } from '../../hooks/useTheme'
import { showToast } from '../Toast'

interface EditorPaneParams {
  filePath: string
  jumpToLine?: number
  jumpToColumn?: number
}

// Tracks the "clean" (last-saved) content per file so we know the baseline
const cleanContentMap = new Map<string, string>()

/**
 * Render and manage a CodeMirror editor for the panel's file inside a Dockview panel.
 *
 * Initializes a CodeMirror EditorView for `params.filePath`, restores or caches editor state,
 * tracks cursor position and dirty state, publishes document content to the external content bus,
 * responds to theme and wrap toggles, updates the Dockview tab title based on dirty state,
 * and performs cleanup (caching state, clearing published content, and resetting dirty state) on unmount.
 *
 * @param params - Panel parameters; `params.filePath` specifies the file to open in the editor.
 * @param api - Dockview panel API used to set the panel title and subscribe to activation changes.
 * @returns The React element tree for the editor pane.
 */
export function EditorPane({ params, api }: IDockviewPanelProps<EditorPaneParams>) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const isReloadingRef = useRef(false)
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

      // Store clean content baseline
      cleanContentMap.set(filePath, result.content)

      const cached = getCachedState(filePath)
      const languageName = getLanguageName(filePath)

      let state: EditorState
      if (cached) {
        state = cached
      } else {
        const extensions = [
          basicSetup,
          themeCompartment.of(getThemeExtension(theme)),
          wrapCompartment.of(getWrapExtension(false)),
          indentationMarkers(),
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
            if (update.docChanged && !isReloadingRef.current) {
              setDirty(filePath, true)
              publishContent(filePath, update.state.doc.toString())
            }
          }),
          keymap.of([
            {
              key: 'Mod-s',
              run: (view) => {
                const content = view.state.doc.toString()
                window.api.writeFile(filePath, content).then((res) => {
                  if ('success' in res) {
                    cleanContentMap.set(filePath, content)
                    setDirty(filePath, false)
                  }
                })
                return true
              },
            },
            {
              key: 'Mod-Alt-w',
              run: (view) => {
                const enabled = toggleWrap()
                view.dispatch({
                  effects: wrapCompartment.reconfigure(getWrapExtension(enabled)),
                })
                return true
              },
            },
          ]),
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
      publishContent(filePath, state.doc.toString())
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
      setDirty(filePath, false)
      clearContent(filePath)
      cleanContentMap.delete(filePath)
    }
  }, [filePath]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reload file content from disk into the editor
  async function reloadFromDisk(path: string) {
    const view = viewRef.current
    if (!view) return
    const result = await window.api.readFile(path)
    if ('error' in result) return

    isReloadingRef.current = true
    cleanContentMap.set(path, result.content)
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: result.content },
    })
    isReloadingRef.current = false
    setDirty(path, false)
    publishContent(path, result.content)
  }

  // Subscribe to file watcher events for external change detection
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const unsub = window.api.onFsWatchEvent(async (events) => {
      const relevant = events.filter((e) => e.path === filePath && !e.isDirectory)
      if (relevant.length === 0) return

      const hasDelete = relevant.some((e) => e.type === 'delete')
      const hasUpdate = relevant.some((e) => e.type === 'update' || e.type === 'create')

      if (hasDelete && !hasUpdate) {
        showToast('File was deleted externally')
        setDirty(filePath, true)
        return
      }

      if (!hasUpdate) return

      // Read current disk content
      const result = await window.api.readFile(filePath)
      if ('error' in result) return

      // Skip if content matches what we already have (e.g., we just saved)
      if (result.content === cleanContentMap.get(filePath)) return

      if (isDirty(filePath)) {
        // File has unsaved changes — prompt user
        showToast('File changed on disk', {
          label: 'Reload',
          onClick: () => reloadFromDisk(filePath),
        })
      } else {
        // Clean file — silent reload
        reloadFromDisk(filePath)
      }
    })

    return unsub
  }, [filePath, loading]) // eslint-disable-line react-hooks/exhaustive-deps

  // Hot-swap theme when it changes
  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      effects: themeCompartment.reconfigure(getThemeExtension(theme)),
    })
  }, [theme])

  // Jump to line/column when requested via params
  useEffect(() => {
    const view = viewRef.current
    if (!view || !params.jumpToLine) return
    const lineNum = Math.min(params.jumpToLine, view.state.doc.lines)
    const line = view.state.doc.line(lineNum)
    const col = Math.min((params.jumpToColumn ?? 1) - 1, line.length)
    const pos = line.from + col
    view.dispatch({
      selection: { anchor: pos },
      scrollIntoView: true,
    })
    view.focus()
  }, [params.jumpToLine, params.jumpToColumn])

  // Update Dockview tab title when dirty state changes
  useEffect(() => {
    const name = filePath.split('/').pop() ?? filePath
    const unsub = onDirtyChange((changedPath, dirty) => {
      if (changedPath !== filePath) return
      api.setTitle(dirty ? '• ' + name : name)
    })
    return unsub
  }, [filePath, api])

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
