/**
 * Shared markdown-to-HTML rendering utility.
 * Used by MarkdownPreviewPane and chat MessageBubble.
 */

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

// Register highlight.js languages once
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

const marked = new Marked()
marked.use({
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

/**
 * Render markdown content to sanitized HTML with syntax-highlighted code blocks.
 */
export function renderMarkdown(content: string): string {
  const raw = marked.parse(content, { async: false }) as string
  return DOMPurify.sanitize(raw)
}
