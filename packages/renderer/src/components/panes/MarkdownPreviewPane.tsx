import { useCallback, useEffect, useState, useRef } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { renderMarkdown } from '../../lib/markdownRenderer'
import { getContent, subscribeContent } from '../../lib/editor/editorContentBus'
import { getAppActions } from '../../lib/appActions'
import '../../styles/markdown-preview.css'

interface MarkdownPreviewParams {
  filePath: string
  zoomFactor?: number
}

/**
 * Render a live preview of the markdown located at the provided file path.
 *
 * The preview synchronizes with in-memory editor content when available, falls back to reading the file from disk,
 * highlights fenced code blocks, and sanitizes generated HTML before rendering.
 *
 * @param params - Panel parameters; must include `filePath` (path to the markdown source) and may include `zoomFactor`
 * @returns A React element containing the rendered, sanitized HTML preview of the markdown content
 */
export function MarkdownPreviewPane({ params }: IDockviewPanelProps<MarkdownPreviewParams>) {
  const { filePath } = params
  const [content, setContent] = useState<string>(() => getContent(filePath) ?? '')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Subscribe to live editor content
  useEffect(() => {
    const initial = getContent(filePath)
    if (initial !== undefined) setContent(initial)
    return subscribeContent(filePath, setContent)
  }, [filePath])

  // Fall back to reading from disk if no editor content available
  useEffect(() => {
    if (getContent(filePath) !== undefined) return
    let cancelled = false
    window.api.readFile(filePath).then((res) => {
      if (!cancelled && getContent(filePath) === undefined && 'content' in res) {
        setContent(res.content)
      }
    })
    return () => { cancelled = true }
  }, [filePath])

  // Render markdown to sanitized HTML with debounce
  const [html, setHtml] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => {
      setHtml(renderMarkdown(content))
    }, 50)
    return () => clearTimeout(timer)
  }, [content])

  const handleLinkClick = useCallback((e: React.MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest('a')
    if (!anchor) return
    e.preventDefault()
    const href = anchor.getAttribute('href')
    if (href && /^https?:\/\//.test(href)) {
      getAppActions()?.openUrl(href)
    }
  }, [])

  return (
    <div
      className="markdown-preview"
      ref={scrollRef}
      style={{ ['--panel-zoom' as string]: String(params.zoomFactor ?? 1) }}
    >
      {/* Safe: all HTML is sanitized through DOMPurify above */}
      {/* Links are intercepted via handleLinkClick and routed through openUrl */}
      <div
        className="markdown-preview__body"
        onClick={handleLinkClick}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
