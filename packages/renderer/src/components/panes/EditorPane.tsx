import { useEffect, useRef, useState, useCallback } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { indentationMarkers } from '@replit/codemirror-indentation-markers'
import { getLanguageExtension, getLanguageName } from '../../lib/editor/languageExtension'
import {
  themeCompartment,
  editorMetricsCompartment,
  getThemeExtension,
  getEditorMetricsExtension,
} from '../../lib/editor/editorTheme'
import { wrapCompartment, getWrapExtension, toggleWrap } from '../../lib/editor/editorWrap'
import { consumeCachedState } from '../../lib/editor/editorStateCache'
import {
  getDocumentSession,
  putDocumentSession,
  updateDocumentFromEditor,
  markSaved,
  markDiskChangedWhileDirty,
  removeDocumentSession,
  onDocumentSessionChanged,
} from '../../lib/editor/documentStore'
import { publishContent, clearContent } from '../../lib/editor/editorContentBus'
import { getPanelZoomFactor } from '../../lib/panelZoom'
import { clearActiveEditor, setActiveEditor } from '../../lib/editor/activeEditor'
import { setContext } from '../../commands/ContextKeys'
import { useEditorStatus } from '../../hooks/useEditorStatus'
import { useTheme } from '../../hooks/useTheme'
import { showToast } from '../shared/Toast'
import { diffCompartment, toggleInlineDiff } from '../../lib/editor/editorInlineDiff'
import { EditorBreadcrumbBar } from './EditorBreadcrumbBar'
import '../../styles/inline-diff.css'
import '../../styles/editor-breadcrumb.css'

interface EditorPaneParams {
  filePath: string
  workspaceRoot?: string | null
  workspaceId?: string
  jumpToLine?: number
  jumpToColumn?: number
  zoomFactor?: number
}

const EDITOR_BASE_FONT_SIZE = 13

function clampSelectionToDoc(doc: string, anchor: number, head: number) {
  const len = doc.length
  return {
    anchor: Math.max(0, Math.min(anchor, len)),
    head: Math.max(0, Math.min(head, len)),
  }
}

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
  const focusRafRef = useRef<number | null>(null)
  const { theme } = useTheme()
  const { setStatus } = useEditorStatus()
  const paramsRef = useRef(params)
  const themeRef = useRef(theme)
  const setStatusRef = useRef(setStatus)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [diffActive, setDiffActive] = useState(false)

  const filePath = params.filePath
  const workspaceRoot = params.workspaceRoot ?? null
  const workspaceId = params.workspaceId

  const toggleInlineDiffForView = useCallback(
    async (view: EditorView) => {
      const diffRoot =
        (workspaceId ? await window.api.getWorkspaceRoot(workspaceId) : null) ??
        workspaceRoot ??
        (await window.api.getWorkspaceRoot())
      const enabled = await toggleInlineDiff(view, diffRoot, filePath)
      setDiffActive(enabled)
      showToast(enabled ? 'Inline diff enabled' : 'Inline diff disabled')
      return enabled
    },
    [filePath, workspaceId, workspaceRoot],
  )

  useEffect(() => {
    paramsRef.current = params
    themeRef.current = theme
    setStatusRef.current = setStatus
  }, [params, setStatus, theme])

  const focusEditor = useCallback(() => {
    if (focusRafRef.current !== null) {
      window.cancelAnimationFrame(focusRafRef.current)
    }
    focusRafRef.current = window.requestAnimationFrame(() => {
      focusRafRef.current = null
      if (!api.isActive) return
      viewRef.current?.focus()
    })
  }, [api])

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

      const disk = result.content
      const wid = paramsRef.current.workspaceId
      let session = getDocumentSession(wid, filePath)

      let initialDoc = disk
      let restoredFromCache = consumeCachedState(filePath)
      let selectionFromEditorState = restoredFromCache?.selection

      if (session?.isDirty) {
        initialDoc = session.workingCopy
        if (session.cleanBaseline === '') {
          putDocumentSession(wid, filePath, {
            cleanBaseline: disk,
            workingCopy: session.workingCopy,
            isDirty: true,
            selection: session.selection,
            diskChangedWhileDirty: session.diskChangedWhileDirty,
          })
          session = getDocumentSession(wid, filePath)
        }
      } else {
        putDocumentSession(wid, filePath, {
          cleanBaseline: disk,
          workingCopy: disk,
          isDirty: false,
          selection: session?.selection ?? { anchor: 0, head: 0 },
          diskChangedWhileDirty: false,
        })
        initialDoc = disk
      }

      const languageName = getLanguageName(filePath)

      const extensions = [
        basicSetup,
        themeCompartment.of(getThemeExtension(themeRef.current)),
        editorMetricsCompartment.of(
          getEditorMetricsExtension(
            Math.round(EDITOR_BASE_FONT_SIZE * getPanelZoomFactor(paramsRef.current)),
          ),
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
            const sel = update.state.selection.main
            updateDocumentFromEditor(
              paramsRef.current.workspaceId,
              filePath,
              update.state.doc.toString(),
              { anchor: sel.anchor, head: sel.head },
            )
            publishContent(filePath, update.state.doc.toString())
          }
          if (update.selectionSet && !update.docChanged) {
            const sel = update.state.selection.main
            updateDocumentFromEditor(
              paramsRef.current.workspaceId,
              filePath,
              update.state.doc.toString(),
              { anchor: sel.anchor, head: sel.head },
            )
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
                  markSaved(paramsRef.current.workspaceId, filePath, content)
                  window.api.notifyFileSaved(filePath)
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
              void toggleInlineDiffForView(view)
              return true
            },
          },
        ]),
      ]

      const langExt = getLanguageExtension(filePath)
      if (langExt) extensions.push(langExt)

      const docLen = initialDoc.length
      let anchor = 0
      let head = 0
      if (session?.isDirty && session.selection) {
        const c = clampSelectionToDoc(initialDoc, session.selection.anchor, session.selection.head)
        anchor = c.anchor
        head = c.head
      } else if (selectionFromEditorState) {
        anchor = Math.min(selectionFromEditorState.main.anchor, docLen)
        head = Math.min(selectionFromEditorState.main.head, docLen)
      }

      const selection = EditorState.create({
        doc: initialDoc,
        selection: { anchor, head },
      }).selection

      const state = EditorState.create({
        doc: initialDoc,
        extensions,
        selection,
      })

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

      viewRef.current = view
      const selMain = state.selection.main
      updateDocumentFromEditor(wid, filePath, state.doc.toString(), {
        anchor: selMain.anchor,
        head: selMain.head,
      })
      publishContent(filePath, state.doc.toString())
      setLoading(false)

      const pos = state.selection.main.head
      const line = state.doc.lineAt(pos)
      setStatusRef.current({
        line: line.number,
        col: pos - line.from + 1,
        language: languageName,
      })

      if (view.hasFocus) {
        setActiveEditor(view, filePath)
      } else if (api.isActive) {
        focusEditor()
      }

      return () => {
        view.dom.removeEventListener('focusin', handleFocusIn)
        view.dom.removeEventListener('focusout', handleFocusOut)
      }
    }

    let cleanupFocus: (() => void) | undefined
    init()
      .then((cleanup) => {
        cleanupFocus = cleanup
      })
      .catch(() => {
        if (!destroyed) {
          setError('Failed to initialize editor')
          setLoading(false)
        }
      })

    return () => {
      destroyed = true
      cleanupFocus?.()
      if (viewRef.current) {
        clearActiveEditor(viewRef.current)
        const st = viewRef.current.state
        const m = st.selection.main
        updateDocumentFromEditor(paramsRef.current.workspaceId, filePath, st.doc.toString(), {
          anchor: m.anchor,
          head: m.head,
        })
        viewRef.current.destroy()
        viewRef.current = null
      }
      if (focusRafRef.current !== null) {
        window.cancelAnimationFrame(focusRafRef.current)
        focusRafRef.current = null
      }
      removeDocumentSession(paramsRef.current.workspaceId, filePath)
      clearContent(filePath)
    }
  }, [api, filePath, focusEditor, workspaceId, toggleInlineDiffForView])

  async function reloadFromDisk(path: string) {
    const view = viewRef.current
    if (!view) return
    const result = await window.api.readFile(path)
    if ('error' in result) return

    isReloadingRef.current = true
    markSaved(paramsRef.current.workspaceId, path, result.content)
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: result.content },
    })
    isReloadingRef.current = false
    publishContent(path, result.content)
  }

  useEffect(() => {
    if (loading) return

    const unsub = window.api.onFsWatchEvent(async (events) => {
      const view = viewRef.current
      if (!view) return
      const wid = paramsRef.current.workspaceId

      const relevant = events.filter(
        (e) => (!wid || e.workspaceId === wid) && e.path === filePath && !e.isDirectory,
      )
      if (relevant.length === 0) return

      const hasDelete = relevant.some((e) => e.type === 'delete')
      const hasUpdate = relevant.some((e) => e.type === 'update' || e.type === 'create')

      if (hasDelete && !hasUpdate) {
        showToast('File was deleted externally')
        const st = view.state
        const text = st.doc.toString()
        putDocumentSession(wid, filePath, {
          cleanBaseline: text,
          workingCopy: text,
          isDirty: true,
          selection: { anchor: st.selection.main.anchor, head: st.selection.main.head },
          diskChangedWhileDirty: true,
        })
        return
      }

      if (!hasUpdate) return

      const sess = getDocumentSession(wid, filePath)
      const baseline = sess?.cleanBaseline

      const diskResult = await window.api.readFile(filePath)
      if ('error' in diskResult) return

      if (baseline !== undefined && diskResult.content === baseline) return

      const dirty = sess?.isDirty ?? false
      if (dirty) {
        markDiskChangedWhileDirty(wid, filePath)
        showToast('File changed on disk', {
          label: 'Reload',
          onClick: () => reloadFromDisk(filePath),
        })
      } else {
        reloadFromDisk(filePath)
      }
    })

    return unsub
  }, [filePath, loading])

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

  useEffect(() => {
    const name = filePath.split('/').pop() ?? filePath
    const wid = (params.workspaceId ?? '') as string
    const applyTitle = () => {
      // Tab dirty state is rendered by EditorTab; no need to prefix the title.
      api.setTitle(name)
    }
    applyTitle()
    const unsub = onDocumentSessionChanged((wk, path) => {
      if (path === filePath && wk === wid) applyTitle()
    })
    return unsub
  }, [filePath, api, params.workspaceId])

  useEffect(() => {
    const disposable = api.onDidActiveChange(({ isActive }) => {
      if (isActive && viewRef.current) {
        focusEditor()
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
  }, [api, filePath, focusEditor, setStatus])

  const handleDiffBadgeClick = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    void toggleInlineDiffForView(view)
  }, [toggleInlineDiffForView])

  if (error) {
    return (
      <div className="editor-pane">
        <div className="editor-pane__error">{error}</div>
      </div>
    )
  }

  return (
    <div className="editor-pane">
      <EditorBreadcrumbBar filePath={filePath} workspaceRoot={workspaceRoot} />
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
