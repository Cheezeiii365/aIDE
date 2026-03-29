import { useState, useCallback, useEffect, useRef } from 'react'

interface WorkingSetPickerProps {
  workingSet: string[]
  onWorkingSetChange: (paths: string[]) => void
  workspaceRoot?: string
}

export function WorkingSetPicker({ workingSet, onWorkingSetChange, workspaceRoot }: WorkingSetPickerProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [allFiles, setAllFiles] = useState<string[]>([])
  const filterRef = useRef<HTMLInputElement>(null)

  // Load file list when dropdown opens
  useEffect(() => {
    let cancelled = false
    if (!dropdownOpen || !workspaceRoot) return () => { cancelled = true }

    setAllFiles([])
    window.api.listAllFiles(workspaceRoot)
      .then((files) => {
        if (!cancelled) setAllFiles(files)
      })
      .catch(() => {
        if (!cancelled) setAllFiles([])
      })

    return () => { cancelled = true }
  }, [dropdownOpen, workspaceRoot])

  // Focus filter input when dropdown opens
  useEffect(() => {
    if (dropdownOpen) {
      requestAnimationFrame(() => filterRef.current?.focus())
    }
  }, [dropdownOpen])

  const removeFile = useCallback(
    (path: string) => {
      onWorkingSetChange(workingSet.filter((p) => p !== path))
    },
    [workingSet, onWorkingSetChange],
  )

  const addFile = useCallback(
    (path: string) => {
      if (!workingSet.includes(path)) {
        onWorkingSetChange([...workingSet, path])
      }
      setDropdownOpen(false)
      setFilter('')
    },
    [workingSet, onWorkingSetChange],
  )

  const basename = (p: string) => p.split('/').pop() ?? p

  const filteredFiles = filter
    ? allFiles.filter((f) => f.toLowerCase().includes(filter.toLowerCase()))
    : allFiles

  return (
    <div className="chat-working-set">
      {workingSet.map((path) => (
        <span key={path} className="chat-working-set__chip" title={path}>
          {basename(path)}
          <button
            className="chat-working-set__chip-remove"
            onClick={() => removeFile(path)}
          >
            &times;
          </button>
        </span>
      ))}
      <button
        className="chat-working-set__add"
        onClick={() => setDropdownOpen(!dropdownOpen)}
      >
        +
      </button>

      {dropdownOpen && (
        <div className="chat-working-set__dropdown">
          <input
            ref={filterRef}
            className="chat-working-set__dropdown-input"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files..."
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setDropdownOpen(false)
                setFilter('')
              }
            }}
          />
          {filteredFiles.slice(0, 100).map((file) => {
            const inSet = workingSet.includes(file)
            return (
              <button
                key={file}
                className={`chat-working-set__dropdown-item${inSet ? ' chat-working-set__dropdown-item--selected' : ''}`}
                onClick={() => addFile(file)}
              >
                {inSet && '\u2713 '}{file}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
