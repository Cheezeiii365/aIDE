import { useEffect, useRef, useState, useCallback } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { EditorState, StateEffect } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { indentationMarkers } from '@replit/codemirror-indentation-markers'
import { getLanguageExtension, getLanguageName } from '../../lib/languageExtension'
import { themeCompartment, editorMetricsCompartment, getThemeExtension, getEditorMetricsExtension } from '../../lib/editorTheme'
import { wrapCompartment, getWrapExtension, toggleWrap } from '../../lib/editorWrap'
import { getCachedState, setCachedState } from '../../lib/editorStateCache'
import { isDirty, setDirty, onDirtyChange } from '../../lib/editorDirtyState'
import { publishContent, clearContent } from '../../lib/editorContentBus'
import { getPanelZoomFactor } from '../../lib/panelZoom'
import { clearActiveEditor, setActiveEditor } from '../../lib/activeEditor'
import { setContext } from '../../lib/ContextKeys'
import { useEditorStatus } from '../../hooks/useEditorStatus'
import { useTheme } from '../../hooks/useTheme'
import { showToast } from '../Toast'
import { diffCompartment, toggleInlineDiff, isInlineDiffActive } from '../../lib/editorInlineDiff'
import '../../styles/inline-diff.css'

interface EditorPaneParams {
  filePath: string
  workspaceRoot: string | null
  jumpToLine?: number
  jumpToColumn?: number
  zoomFactor?: number
}

const EDITOR_BASE_FONT_SIZE = 13

// Tracks the "clean" (last-saved) content per file so we know the baseline
const cleanContentMap = new Map<string, string>()

/**
 * Render and manage a CodeMirror editor for the panel's file inside a Dockview panel.
 *
 * Initializes and tears down an EditorView for `params.filePath`, tracks cursor position
 * and dirty state, publishes document content to the external content bus, responds to
 * theme and wrap changes, handles external filesystem updates (with optional reload),
 * and supports an initial jump-to-line/column.
 *
 * @param params - Panel parameters. `params.filePath` is the file to open; optional `params.jumpToLine` and `params.jumpToColumn` specify an initial caret position to jump to.
 * @param api - Dockview panel API used to set the panel title and subscribe to activation changes.
 * @returns The React element tree for the editor pane.
 */
export function EditorPane({ params, api }: IDockviewPanelProps<EditorPaneParams>) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const isReloadingRef = useRef(false)
  const { theme } = useTheme()
  const { setStatus } = useEditorStatus()
  const paramsRef = useRef(params)
  const themeRef = useRef(theme)
  const setStatusRef = useRef(setStatus)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [diffActive, setDiffActive] = useState(false)

  const filePath = params.filePath
  const workspaceRoot = params.workspaceRoot

  useEffect(() => {
    paramsRef.current = params
    themeRef.current = theme
    setStatusRef.current = setStatus
  }, [params, setStatus, theme])

  // Create editor on mount
  useEffect(() => {
    if (!hostRef.current) return

    let destroyed = false

    /**
     * Initialize and mount the CodeMirror editor for the current filePath and publish its initial state.
     *
     * Reads the file from disk, records the last-known clean baseline, restores a cached editor state when available or creates a new state with theme, metrics/zoom, wrap, indentation, language, update listeners, and keybindings, then mounts the EditorView, publishes the document content to the external bus, clears the loading indicator, and updates the initial cursor position status. On read failure, sets the component error and clears loading state.
     */
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
          themeCompartment.of(getThemeExtension(themeRef.current)),
          editorMetricsCompartment.of(
            getEditorMetricsExtension(Math.round(EDITOR_BASE_FONT_SIZE * getPanelZoomFactor(paramsRef.current))),
          ),
          wrapCompartment.of(getWrapExtension(false)),
          indentationMarkers(),
          EditorView.updateListener.of((update) => {
            if (update.selectionSet || update.docChanged) {
              const pos = update.state.selection.main.head
              const line = update.state.doc.lineAt(pos)
              setStatusRef.current({
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
          diffCompartment.of([]),
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
            {
              key: 'Mod-Shift-d',
              run: (view) => {
                toggleInlineDiff(view, workspaceRoot, filePath).then((enabled) => {
                  setDiffActive(enabled)
                  showToast(enabled ? 'Inline diff enabled' : 'Inline diff disabled')
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

      const handleFocusIn = () => {
        setActiveEditor(view, filePath)
        setContext('editorInFocus', true)
      }
      const handleFocusOut = (event: FocusEvent) => {
        const nextTarget = event.relatedTarget
        if (!(nextTarget instanceof Node) || !view.dom.contains(nextTarget)) {
          clearActiveEditor(view)
          setContext('editorInFocus', false)
        }
      }
      view.dom.addEventListener('focusin', handleFocusIn)
      view.dom.addEventListener('focusout', handleFocusOut)

      if (cached) {
        view.dispatch({
          effects: StateEffect.appendConfig.of([
            editorMetricsCompartment.of(
              getEditorMetricsExtension(Math.round(EDITOR_BASE_FONT_SIZE * getPanelZoomFactor(paramsRef.current))),
            ),
          ]),
        })
      }

      viewRef.current = view
      publishContent(filePath, state.doc.toString())
      setLoading(false)

      // Push initial cursor position
      const pos = state.selection.main.head
      const line = state.doc.lineAt(pos)
      setStatusRef.current({
        line: line.number,
        col: pos - line.from + 1,
        language: languageName,
      })

      if (view.hasFocus) {
        setActiveEditor(view, filePath)
      }

      return () => {
        view.dom.removeEventListener('focusin', handleFocusIn)
        view.dom.removeEventListener('focusout', handleFocusOut)
      }
    }

    let cleanupFocus: (() => void) | undefined
    init().then((cleanup) => {
      cleanupFocus = cleanup
    })

    return () => {
      destroyed = true
      cleanupFocus?.()
      if (viewRef.current) {
        clearActiveEditor(viewRef.current)
        setCachedState(filePath, viewRef.current.state)
        viewRef.current.destroy()
        viewRef.current = null
      }
      setDirty(filePath, false)
      clearContent(filePath)
      cleanContentMap.delete(filePath)
    }
  }, [filePath])

  /**
   * Replace the editor's document with the file's current disk contents.
   *
   * Reads the file at `path` and, if successful and an editor is mounted, replaces the entire document with the disk content, updates the stored clean baseline for `path`, clears the dirty flag for the file, and publishes the new content.
   *
   * @param path - Filesystem path of the file to reload; does nothing if no editor is mounted or the read fails
   */
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
  }, [filePath, loading])

  // Hot-swap theme when it changes
  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      effects: themeCompartment.reconfigure(getThemeExtension(theme)),
    })
  }, [theme])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: editorMetricsCompartment.reconfigure(
        getEditorMetricsExtension(Math.round(EDITOR_BASE_FONT_SIZE * getPanelZoomFactor(params))),
      ),
    })
    view.requestMeasure()
  }, [params])

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

  // Listen for external toggle-inline-diff events (e.g., command palette)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const handler = () => {
      toggleInlineDiff(view, workspaceRoot, filePath).then((enabled) => {
        setDiffActive(enabled)
        showToast(enabled ? 'Inline diff enabled' : 'Inline diff disabled')
      })
    }
    window.addEventListener('aide:toggle-inline-diff', handler)
    return () => window.removeEventListener('aide:toggle-inline-diff', handler)
  }, [filePath, loading, workspaceRoot])

  // Push cursor status when this panel becomes active
  useEffect(() => {
    const disposable = api.onDidActiveChange(({ isActive }) => {
      if (isActive && viewRef.current) {
        setActiveEditor(viewRef.current, filePath)
        const state = viewRef.current.state
        const pos = state.selection.main.head
        const line = state.doc.lineAt(pos)
        setStatus({
          line: line.number,
          col: pos - line.from + 1,
          language: getLanguageName(filePath),
        })
      } else if (viewRef.current) {
        clearActiveEditor(viewRef.current)
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

  const handleDiffBadgeClick = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    toggleInlineDiff(view, workspaceRoot, filePath).then((enabled) => {
      setDiffActive(enabled)
      showToast(enabled ? 'Inline diff enabled' : 'Inline diff disabled')
    })
  }, [filePath, workspaceRoot])

  return (
    <div className="editor-pane">
      {loading && <div className="editor-pane__loading">Loading…</div>}
      {diffActive && (
        <div
          className="editor-pane__diff-badge"
          onClick={handleDiffBadgeClick}
          title="Click to close diff view (Cmd+Shift+D)"
        >
          DIFF
        </div>
      )}
      <div
        ref={hostRef}
        className="editor-pane__cm-host"
        style={{ display: loading ? 'none' : 'block' }}
      />
    </div>
  )
}
