import { useCallback, useEffect, useState, useRef, useMemo } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { Marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import markdown from 'highlight.js/lib/languages/markdown'
import { getContent, subscribeContent } from '../../lib/editorContentBus'
import { getAppActions } from '../../lib/appActions'
import '../../styles/markdown-preview.css'

// Register highlight.js languages
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('jsx', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('tsx', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('css', css)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('zsh', bash)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)

interface MarkdownPreviewParams {
  filePath: string
}

/**
 * Render a live, syntax-highlighted preview of the markdown content for the given file path.
 *
 * The preview stays in sync with editor content when available, falls back to reading the file from disk,
 * highlights code blocks with highlight.js, debounces rendering, and sanitizes output with DOMPurify.
 *
 * @param params - Panel parameters containing `filePath`, the path used to source markdown content
 * @returns A React element containing the sanitized HTML preview of the markdown content
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

  // Configure marked instance with highlight.js for code blocks
  const marked = useMemo(() => {
    const instance = new Marked()
    instance.use({
      renderer: {
        code({ text, lang }: { text: string; lang?: string }) {
          let highlighted: string
          if (lang && hljs.getLanguage(lang)) {
            highlighted = hljs.highlight(text, { language: lang }).value
          } else {
            highlighted = hljs.highlightAuto(text).value
          }
          const langClass = lang ? ` class="language-${lang}"` : ''
          return `<pre><code${langClass}>${highlighted}</code></pre>`
        },
      },
    })
    return instance
  }, [])

  // Render markdown to sanitized HTML with debounce
  // Content is sanitized via DOMPurify before rendering to prevent XSS
  const [html, setHtml] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => {
      const raw = marked.parse(content, { async: false }) as string
      setHtml(DOMPurify.sanitize(raw))
    }, 50)
    return () => clearTimeout(timer)
  }, [content, marked])

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
    <div className="markdown-preview" ref={scrollRef}>
      {/* Safe: all HTML is sanitized through DOMPurify above */}
      {/* Links are intercepted via handleLinkClick and routed through openUrl */}
      <div
        className="markdown-preview__body"
        onClick={handleLinkClick}
        dangerouslySetInnerHTML={{ __html: html }}  // eslint-disable-line -- content is DOMPurify-sanitized (line 91)
      />
    </div>
  )
}
