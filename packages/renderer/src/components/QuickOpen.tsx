import { useState, useEffect, useMemo } from 'react'
import { SearchPanel, type SearchPanelItem } from './SearchPanel'
import { getAppActions } from '../lib/appActions'
import { FileTypeIcon } from './FileTree/FileTypeIcon'

interface QuickOpenProps {
  onClose: () => void
  workspaceRoot: string | null
}

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
