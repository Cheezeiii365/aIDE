import type { EditorState } from '@codemirror/state'
import { getActiveEditor } from './activeEditor'

type CommentResult = 'ok' | 'no-editor' | 'unsupported'
type CommentMode = 'toggle' | 'comment' | 'uncomment'

interface CommentTokens {
  line?: string
}

function getSelectedLineNumbers(state: EditorState): number[] {
  const seen = new Set<number>()
  const lineNumbers: number[] = []

  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number
    const endPos = range.to > range.from ? range.to - 1 : range.to
    const endLine = state.doc.lineAt(endPos).number

    for (let lineNo = startLine; lineNo <= endLine; lineNo++) {
      if (seen.has(lineNo)) continue
      seen.add(lineNo)
      lineNumbers.push(lineNo)
    }
  }

  return lineNumbers
}

function getLineCommentToken(state: EditorState, lineFrom: number): string | null {
  const entries = state.languageDataAt('commentTokens', lineFrom) as CommentTokens[]
  for (const entry of entries) {
    if (entry.line) return entry.line
  }
  return null
}

function updateLineCommentsInActiveEditor(mode: CommentMode): CommentResult {
  const activeEditor = getActiveEditor()
  if (!activeEditor) return 'no-editor'

  const { view } = activeEditor
  const lineNumbers = getSelectedLineNumbers(view.state)
  if (lineNumbers.length === 0) return 'no-editor'

  const token = getLineCommentToken(view.state, view.state.doc.line(lineNumbers[0]).from)
  if (!token) return 'unsupported'

  const lines = lineNumbers.map((lineNo) => view.state.doc.line(lineNo))
  const nonBlankLines = lines.filter((line) => line.text.trim().length > 0)
  if (nonBlankLines.length === 0) return 'ok'

  const allCommentable = nonBlankLines.every((line) => getLineCommentToken(view.state, line.from) === token)
  if (!allCommentable) return 'unsupported'

  const allCommented = nonBlankLines.every((line) => {
    const indent = line.text.match(/^\s*/)?.[0].length ?? 0
    return line.text.slice(indent).startsWith(token)
  })
  const shouldUncomment = mode === 'uncomment' || (mode === 'toggle' && allCommented)
  const shouldComment = mode === 'comment' || (mode === 'toggle' && !allCommented)

  const changes: { from: number; to?: number; insert: string }[] = []

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (line.text.trim().length === 0) continue

    const indent = line.text.match(/^\s*/)?.[0].length ?? 0
    const offset = line.from + indent

    if (shouldUncomment && line.text.slice(indent).startsWith(token)) {
      let removeTo = offset + token.length
      if (line.text.slice(indent + token.length).startsWith(' ')) {
        removeTo += 1
      }
      changes.push({ from: offset, to: removeTo, insert: '' })
    } else if (shouldComment && !line.text.slice(indent).startsWith(token)) {
      changes.push({ from: offset, insert: `${token} ` })
    }
  }

  if (changes.length === 0) return 'ok'

  view.dispatch({ changes, scrollIntoView: true })
  view.focus()
  return 'ok'
}

export function toggleLineCommentInActiveEditor(): CommentResult {
  return updateLineCommentsInActiveEditor('toggle')
}

export function commentLineInActiveEditor(): CommentResult {
  return updateLineCommentsInActiveEditor('comment')
}

export function uncommentLineInActiveEditor(): CommentResult {
  return updateLineCommentsInActiveEditor('uncomment')
}
