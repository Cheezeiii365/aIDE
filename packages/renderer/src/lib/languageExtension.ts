import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { markdown } from '@codemirror/lang-markdown'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import type { Extension } from '@codemirror/state'

interface LangDef {
  ext: Extension
  name: string
}

const LANG_MAP: Record<string, LangDef> = {
  '.ts':   { ext: javascript({ jsx: true, typescript: true }), name: 'TypeScript' },
  '.tsx':  { ext: javascript({ jsx: true, typescript: true }), name: 'TypeScript JSX' },
  '.js':   { ext: javascript({ jsx: true }), name: 'JavaScript' },
  '.jsx':  { ext: javascript({ jsx: true }), name: 'JavaScript JSX' },
  '.mjs':  { ext: javascript(), name: 'JavaScript' },
  '.cjs':  { ext: javascript(), name: 'JavaScript' },
  '.py':   { ext: python(), name: 'Python' },
  '.md':   { ext: markdown(), name: 'Markdown' },
  '.json': { ext: json(), name: 'JSON' },
  '.css':  { ext: css(), name: 'CSS' },
  '.html': { ext: html(), name: 'HTML' },
  '.htm':  { ext: html(), name: 'HTML' },
}

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : ''
}

export function getLanguageExtension(filePath: string): Extension | null {
  return LANG_MAP[getExtension(filePath)]?.ext ?? null
}

export function getLanguageName(filePath: string): string {
  return LANG_MAP[getExtension(filePath)]?.name ?? 'Plain Text'
}
