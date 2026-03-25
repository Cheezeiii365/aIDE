import { useState, useEffect } from 'react'
import { useEditorStatus } from '../hooks/useEditorStatus'

/**
 * Render an inline SVG icon representing a Git branch.
 *
 * The icon uses `currentColor` for its strokes, has a `0 0 16 16` viewBox, and is composed of three circles connected by a path to depict a branch.
 *
 * @returns A React element containing the SVG for the Git branch icon.
 */
function GitBranchIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="4" r="1.5" />
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="11" cy="7" r="1.5" />
      <path d="M5 5.5v5M5 5.5c0 2 1.5 3 4.5 1.5" />
    </svg>
  )
}

/**
 * Displays editor and git status in a footer-oriented status bar.
 *
 * Performs an initial fetch of the current Git branch and subscribes to branch updates while mounted; the subscription is removed on unmount.
 *
 * @returns The footer JSX element showing the Git branch (with icon), current line and column, file encoding, and language.
 */
export function StatusBar() {
  const { status } = useEditorStatus()
  const [branch, setBranch] = useState('main')

  useEffect(() => {
    window.api.getGitStatus().then((result) => {
      if (result) setBranch(result.branch)
    })
    const unsub = window.api.onGitBranchChanged(setBranch)
    return unsub
  }, [])

  return (
    <footer className="status-bar">
      <div className="status-bar__left">
        <span className="status-bar__item status-bar__item--branch">
          <GitBranchIcon />
          {branch}
        </span>
        <div className="status-bar__separator" />
        <span className="status-bar__item">Ln {status.line}, Col {status.col}</span>
      </div>
      <div className="status-bar__right">
        <span className="status-bar__item">UTF-8</span>
        <div className="status-bar__separator" />
        <span className="status-bar__item">{status.language}</span>
      </div>
    </footer>
  )
}
