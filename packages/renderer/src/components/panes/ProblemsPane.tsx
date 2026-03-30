import { useMemo, useCallback } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import type { TaskDiagnostic } from '@aide/shared'
import { getAppActions } from '../../lib/appActions'
import '../../styles/problems-pane.css'

export interface ProblemsPaneParams {
  diagnostics: TaskDiagnostic[]
  zoomFactor?: number
}

interface FileGroup {
  file: string
  diagnostics: TaskDiagnostic[]
}

const SEVERITY_ICON: Record<string, string> = {
  error: '\u2716',   // ✖
  warning: '\u26A0', // ⚠
  info: '\u2139',    // ℹ
}

const SEVERITY_ORDER: Record<string, number> = {
  error: 0,
  warning: 1,
  info: 2,
}

/**
 * Problems panel that displays task diagnostics grouped by file.
 * Clicking a diagnostic opens the file at the relevant line and column.
 */
export function ProblemsPane({ params }: IDockviewPanelProps<ProblemsPaneParams>) {
  const diagnostics = params?.diagnostics ?? []

  const groups = useMemo<FileGroup[]>(() => {
    const map = new Map<string, TaskDiagnostic[]>()
    for (const d of diagnostics) {
      const list = map.get(d.file) ?? []
      list.push(d)
      map.set(d.file, list)
    }
    // Sort groups by file name, diagnostics by severity then line
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, diags]) => ({
        file,
        diagnostics: diags.sort((a, b) => {
          const sevDiff = (SEVERITY_ORDER[a.severity] ?? 2) - (SEVERITY_ORDER[b.severity] ?? 2)
          if (sevDiff !== 0) return sevDiff
          return (a.line ?? 0) - (b.line ?? 0)
        }),
      }))
  }, [diagnostics])

  const errorCount = useMemo(() => diagnostics.filter((d) => d.severity === 'error').length, [diagnostics])
  const warningCount = useMemo(() => diagnostics.filter((d) => d.severity === 'warning').length, [diagnostics])

  const handleClick = useCallback((diag: TaskDiagnostic) => {
    const actions = getAppActions()
    if (actions) {
      actions.openFile(diag.file, { line: diag.line, column: diag.column })
    }
  }, [])

  if (diagnostics.length === 0) {
    return (
      <div className="problems-pane problems-pane--empty">
        <span className="problems-pane__empty-msg">No problems detected</span>
      </div>
    )
  }

  return (
    <div className="problems-pane">
      <div className="problems-pane__summary">
        {errorCount > 0 && (
          <span className="problems-pane__count problems-pane__count--error">
            {SEVERITY_ICON.error} {errorCount}
          </span>
        )}
        {warningCount > 0 && (
          <span className="problems-pane__count problems-pane__count--warning">
            {SEVERITY_ICON.warning} {warningCount}
          </span>
        )}
        <span className="problems-pane__count">
          {diagnostics.length} problem{diagnostics.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="problems-pane__list">
        {groups.map((group) => (
          <div key={group.file} className="problems-pane__group">
            <div className="problems-pane__file-header">
              {group.file}
              <span className="problems-pane__file-count">{group.diagnostics.length}</span>
            </div>
            {group.diagnostics.map((diag, i) => (
              <button
                key={`${diag.file}:${diag.line}:${diag.column}:${i}`}
                className={`problems-pane__item problems-pane__item--${diag.severity}`}
                onClick={() => handleClick(diag)}
              >
                <span className="problems-pane__severity">{SEVERITY_ICON[diag.severity]}</span>
                <span className="problems-pane__message">{diag.message}</span>
                <span className="problems-pane__location">
                  {diag.line != null ? `:${diag.line}` : ''}
                  {diag.column != null ? `:${diag.column}` : ''}
                </span>
                {diag.source && (
                  <span className="problems-pane__source">[{diag.source}]</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
