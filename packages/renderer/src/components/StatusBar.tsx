import { useState, useEffect } from 'react'
import { useEditorStatus } from '../hooks/useEditorStatus'
import type { TaskExecution } from '@aide/shared'

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

function TaskSpinner() {
  return (
    <svg className="status-bar__spinner" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 2a6 6 0 1 1-4.24 1.76" />
    </svg>
  )
}

interface StatusBarProps {
  runningTasks?: TaskExecution[]
}

export function StatusBar({ runningTasks = [] }: StatusBarProps) {
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
        {runningTasks.length > 0 && (
          <>
            <div className="status-bar__separator" />
            <span className="status-bar__item status-bar__item--tasks">
              <TaskSpinner />
              {runningTasks.length} task{runningTasks.length !== 1 ? 's' : ''}
            </span>
          </>
        )}
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
