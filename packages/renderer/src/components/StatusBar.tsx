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

export function StatusBar() {
  return (
    <footer className="status-bar">
      <div className="status-bar__left">
        <span className="status-bar__item status-bar__item--branch">
          <GitBranchIcon />
          main
        </span>
        <div className="status-bar__separator" />
        <span className="status-bar__item">Ln 1, Col 1</span>
      </div>
      <div className="status-bar__right">
        <span className="status-bar__item">UTF-8</span>
        <div className="status-bar__separator" />
        <span className="status-bar__item">TypeScript</span>
      </div>
    </footer>
  )
}
