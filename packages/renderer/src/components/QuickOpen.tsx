import { useState, useEffect, useMemo } from 'react'
import { SearchPanel, type SearchPanelItem } from './SearchPanel'
import { getAppActions } from '../lib/appActions'
import { FileTypeIcon } from './FileTree/FileTypeIcon'

interface QuickOpenProps {
  onClose: () => void
  workspaceRoot: string | null
}

/**
 * Render a searchable quick-open panel that lists files from the current workspace.
 *
 * The panel shows file names with their parent directory, displays a contextual empty
 * message when no workspace is open or no files are found, and opens the selected file.
 *
 * @param onClose - Callback invoked to close the panel
 * @param workspaceRoot - Workspace root path; when `null`, the panel shows "No workspace open" and selection is disabled
 * @returns A SearchPanel configured to search and open files from the current workspace
 */
export function QuickOpen({ onClose, workspaceRoot }: QuickOpenProps) {
  const [files, setFiles] = useState<string[]>([])

  useEffect(() => {
    if (!workspaceRoot) return
    window.api.listAllFiles(workspaceRoot).then(setFiles)
  }, [workspaceRoot])

  const items = useMemo((): SearchPanelItem[] => {
    return files.map((relPath) => {
      const name = relPath.split('/').pop() ?? relPath
      const dir = relPath.slice(0, relPath.length - name.length).replace(/\/$/, '')
      return {
        id: relPath,
        label: name,
        description: dir || undefined,
        icon: <FileTypeIcon name={name} />,
      }
    })
  }, [files])

  return (
    <SearchPanel
      placeholder="Search files by name..."
      items={items}
      onSelect={(item) => {
        if (!workspaceRoot) return
        const fullPath = `${workspaceRoot}/${item.id}`
        getAppActions()?.openFile(fullPath)
        onClose()
      }}
      onClose={onClose}
      emptyMessage={workspaceRoot ? 'No files found' : 'No workspace open'}
    />
  )
}
