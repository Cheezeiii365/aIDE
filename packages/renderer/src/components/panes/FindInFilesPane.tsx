import { useState, useEffect, useRef, useCallback } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import type { SearchFileResult, SearchMatch } from '@aide/shared'
import { getAppActions } from '../../lib/appActions'

interface FindInFilesParams {
  workspaceRoot: string
}

interface FileGroup {
  filePath: string
  matches: SearchMatch[]
  collapsed: boolean
}

export function FindInFilesPane({ params }: IDockviewPanelProps<FindInFilesParams>) {
  const [query, setQuery] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [isRegex, setIsRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [fileGlob, setFileGlob] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [showGlob, setShowGlob] = useState(false)
  const [results, setResults] = useState<FileGroup[]>([])
  const [searching, setSearching] = useState(false)
  const [totalMatches, setTotalMatches] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Subscribe to search results and completion
  useEffect(() => {
    const unsubResults = window.api.onSearchResults((newResults: SearchFileResult[]) => {
      setResults((prev) => {
        const map = new Map(prev.map((g) => [g.filePath, g]))
        for (const r of newResults) {
          const existing = map.get(r.filePath)
          if (existing) {
            existing.matches.push(...r.matches)
          } else {
            map.set(r.filePath, { ...r, collapsed: false })
          }
        }
        return Array.from(map.values())
      })
    })

    const unsubComplete = window.api.onSearchComplete((summary) => {
      setSearching(false)
      setTotalMatches(summary.totalMatches)
    })

    return () => {
      unsubResults()
      unsubComplete()
    }
  }, [])

  const doSearch = useCallback((q: string) => {
    if (!q.trim() || !params.workspaceRoot) {
      setResults([])
      setTotalMatches(0)
      return
    }

    window.api.searchCancel()
    setResults([])
    setTotalMatches(0)
    setSearching(true)

    window.api.searchStart({
      query: q,
      rootPath: params.workspaceRoot,
      isRegex,
      caseSensitive,
      wholeWord,
      fileGlob: fileGlob || undefined,
    })
  }, [params.workspaceRoot, isRegex, caseSensitive, wholeWord, fileGlob])

  // Debounced search on query/toggle change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(query), 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, doSearch])

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const toggleFileCollapse = (filePath: string) => {
    setResults((prev) =>
      prev.map((g) => (g.filePath === filePath ? { ...g, collapsed: !g.collapsed } : g)),
    )
  }

  const openMatch = (filePath: string, match: SearchMatch) => {
    getAppActions()?.openFile(filePath, { line: match.line, column: match.column })
  }

  const handleReplace = async (filePath: string, match: SearchMatch) => {
    const result = await window.api.searchReplace({
      filePath,
      replacements: [{ line: match.line, column: match.column, matchText: match.matchText, replaceText }],
    })
    if ('success' in result) {
      // Remove replaced match from results
      setResults((prev) =>
        prev.map((g) => {
          if (g.filePath !== filePath) return g
          const filtered = g.matches.filter((m) => m !== match)
          return { ...g, matches: filtered }
        }).filter((g) => g.matches.length > 0),
      )
      setTotalMatches((c) => c - 1)
    }
  }

  const handleReplaceAllInFile = async (filePath: string) => {
    const group = results.find((g) => g.filePath === filePath)
    if (!group) return
    const result = await window.api.searchReplace({
      filePath,
      replacements: group.matches.map((m) => ({
        line: m.line, column: m.column, matchText: m.matchText, replaceText,
      })),
    })
    if ('success' in result) {
      const count = group.matches.length
      setResults((prev) => prev.filter((g) => g.filePath !== filePath))
      setTotalMatches((c) => c - count)
    }
  }

  const handleReplaceAll = async () => {
    for (const group of results) {
      await window.api.searchReplace({
        filePath: group.filePath,
        replacements: group.matches.map((m) => ({
          line: m.line, column: m.column, matchText: m.matchText, replaceText,
        })),
      })
    }
    setResults([])
    setTotalMatches(0)
  }

  const relPath = (fp: string) => {
    if (!params.workspaceRoot) return fp
    return fp.startsWith(params.workspaceRoot)
      ? fp.slice(params.workspaceRoot.length + 1)
      : fp
  }

  return (
    <div className="find-in-files">
      <div className="fif-controls">
        <div className="fif-row">
          <input
            ref={inputRef}
            className="fif-input"
            type="text"
            placeholder="Search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
          <button
            className={`fif-toggle${isRegex ? ' fif-toggle--active' : ''}`}
            onClick={() => setIsRegex((v) => !v)}
            title="Use Regular Expression"
          >.*</button>
          <button
            className={`fif-toggle${caseSensitive ? ' fif-toggle--active' : ''}`}
            onClick={() => setCaseSensitive((v) => !v)}
            title="Match Case"
          >Aa</button>
          <button
            className={`fif-toggle${wholeWord ? ' fif-toggle--active' : ''}`}
            onClick={() => setWholeWord((v) => !v)}
            title="Match Whole Word"
          >ab</button>
          <button
            className="fif-toggle"
            onClick={() => setShowGlob((v) => !v)}
            title="File Filter"
          >**</button>
          <button
            className="fif-toggle"
            onClick={() => setShowReplace((v) => !v)}
            title="Toggle Replace"
          >{showReplace ? '−' : '+'}</button>
        </div>
        {showGlob && (
          <input
            className="fif-input fif-input--glob"
            type="text"
            placeholder="File glob (e.g. *.ts, src/**)"
            value={fileGlob}
            onChange={(e) => setFileGlob(e.target.value)}
            spellCheck={false}
          />
        )}
        {showReplace && (
          <div className="fif-row">
            <input
              className="fif-input"
              type="text"
              placeholder="Replace..."
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              spellCheck={false}
            />
            <button
              className="fif-replace-all-btn"
              onClick={handleReplaceAll}
              title="Replace All"
              disabled={results.length === 0}
            >Replace All</button>
          </div>
        )}
      </div>

      <div className="fif-summary">
        {searching
          ? 'Searching...'
          : totalMatches > 0
            ? `${totalMatches} result${totalMatches === 1 ? '' : 's'} in ${results.length} file${results.length === 1 ? '' : 's'}`
            : query
              ? 'No results found'
              : ''}
      </div>

      <div className="fif-results">
        {results.map((group) => (
          <div key={group.filePath} className="fif-file-group">
            <div
              className="fif-file-header"
              onClick={() => toggleFileCollapse(group.filePath)}
            >
              <span className="fif-chevron">{group.collapsed ? '▸' : '▾'}</span>
              <span className="fif-file-path">{relPath(group.filePath)}</span>
              <span className="fif-match-count">{group.matches.length}</span>
              {showReplace && (
                <button
                  className="fif-replace-file-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleReplaceAllInFile(group.filePath)
                  }}
                  title="Replace All in File"
                >Replace</button>
              )}
            </div>
            {!group.collapsed && group.matches.map((match, i) => (
              <div
                key={`${match.line}:${match.column}:${i}`}
                className="fif-match-row"
                onClick={() => openMatch(group.filePath, match)}
              >
                <span className="fif-line-num">{match.line}</span>
                <span className="fif-line-text">
                  <HighlightedLine text={match.lineText} matchText={match.matchText} column={match.column} />
                </span>
                {showReplace && (
                  <button
                    className="fif-replace-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleReplace(group.filePath, match)
                    }}
                    title="Replace"
                  >⟷</button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function HighlightedLine({ text, matchText, column }: { text: string; matchText: string; column: number }) {
  const colIdx = column - 1
  const before = text.slice(0, colIdx)
  const match = text.slice(colIdx, colIdx + matchText.length)
  const after = text.slice(colIdx + matchText.length)
  return (
    <>
      {before}
      <mark>{match}</mark>
      {after}
    </>
  )
}
