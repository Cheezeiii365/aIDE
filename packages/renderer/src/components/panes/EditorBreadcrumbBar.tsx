import { useMemo } from 'react'

export type LspStatus = 'healthy' | 'starting' | 'down' | 'none'

interface Props {
  filePath: string
  workspaceRoot?: string | null
  // TODO: wire to real LSP status feed once LSP is implemented.
  lspStatus?: LspStatus
}

function relativeSegments(filePath: string, root?: string | null): string[] {
  if (!filePath) return []
  let rel = filePath
  const normalizedRoot = root?.replace(/\/+$/, '')
  if (
    normalizedRoot
    && (filePath === normalizedRoot || filePath.startsWith(`${normalizedRoot}/`))
  ) {
    rel = filePath.slice(normalizedRoot.length)
  }
  return rel.split('/').filter(Boolean)
}

const LSP_LABELS: Record<LspStatus, string> = {
  healthy: 'LSP',
  starting: 'LSP starting',
  down: 'LSP down',
  none: 'No LSP',
}

export function EditorBreadcrumbBar({ filePath, workspaceRoot, lspStatus = 'healthy' }: Props) {
  const segments = useMemo(
    () => relativeSegments(filePath, workspaceRoot ?? null),
    [filePath, workspaceRoot],
  )

  return (
    <div className="editor-breadcrumb">
      <div className="editor-breadcrumb__tools">
        {/* Stub: outline / symbol list */}
        <button type="button" className="editor-breadcrumb__icon-btn" aria-label="Outline" title="Outline">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <circle cx="2" cy="3" r="1" fill="currentColor" />
            <circle cx="2" cy="7" r="1" fill="currentColor" />
            <circle cx="2" cy="11" r="1" fill="currentColor" />
            <path d="M5 3h7M5 7h7M5 11h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
        {/* Stub: in-file search */}
        <button type="button" className="editor-breadcrumb__icon-btn" aria-label="Search in file" title="Search in file">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <circle cx="6" cy="6" r="3.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
            <path d="M9 9l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        {/* Stub: back / forward navigation */}
        <button type="button" className="editor-breadcrumb__icon-btn" aria-label="Back" title="Back">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </button>
        <button type="button" className="editor-breadcrumb__icon-btn" aria-label="Forward" title="Forward">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path d="M5 2l5 5-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </button>
      </div>

      <nav className="editor-breadcrumb__path" aria-label="File path">
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1
          return (
            <span key={`${i}-${seg}`} className="editor-breadcrumb__segment-wrap">
              <button
                type="button"
                className={
                  'editor-breadcrumb__segment' +
                  (isLast ? ' editor-breadcrumb__segment--last' : '')
                }
              >
                {seg}
              </button>
              {!isLast && <span className="editor-breadcrumb__chevron">›</span>}
            </span>
          )
        })}
      </nav>

      <div className="editor-breadcrumb__right">
        <span
          className={`editor-breadcrumb__lsp editor-breadcrumb__lsp--${lspStatus}`}
          title={LSP_LABELS[lspStatus]}
        >
          <span className="editor-breadcrumb__lsp-dot" />
          {LSP_LABELS[lspStatus]}
        </span>
      </div>
    </div>
  )
}
