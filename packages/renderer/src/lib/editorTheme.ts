import { Compartment } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { oneDark } from '@codemirror/theme-one-dark'
import type { ThemeName } from '@aide/shared'

export const themeCompartment = new Compartment()

const baseTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
})

/* ─── Atom One Light — CodeMirror theme ────────────────────── */
const oneLightTheme = EditorView.theme(
  {
    '&': {
      color: '#383a42',
      backgroundColor: '#fafafa',
    },
    '.cm-content': { caretColor: '#526fff' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#526fff' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: 'rgba(56, 113, 220, 0.12)' },
    '.cm-searchMatch': { backgroundColor: '#e2e8f0', outline: '1px solid #cbd5e1' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#bfdbfe' },
    '.cm-activeLine': { backgroundColor: 'rgba(0, 0, 0, 0.03)' },
    '.cm-selectionMatch': { backgroundColor: 'rgba(56, 113, 220, 0.08)' },
    '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
      backgroundColor: 'rgba(56, 113, 220, 0.15)',
    },
    '.cm-gutters': {
      backgroundColor: '#f0f0f1',
      color: '#a0a1a7',
      border: 'none',
    },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(0, 0, 0, 0.04)' },
    '.cm-foldPlaceholder': {
      backgroundColor: 'transparent',
      border: 'none',
      color: '#a0a1a7',
    },
    '.cm-tooltip': {
      border: '1px solid #d4d4d5',
      backgroundColor: '#f0f0f1',
    },
    '.cm-tooltip .cm-tooltip-arrow:before': { borderTopColor: '#d4d4d5', borderBottomColor: '#d4d4d5' },
    '.cm-tooltip .cm-tooltip-arrow:after': { borderTopColor: '#f0f0f1', borderBottomColor: '#f0f0f1' },
    '.cm-tooltip-autocomplete': {
      '& > ul > li[aria-selected]': { backgroundColor: 'rgba(56, 113, 220, 0.12)', color: '#383a42' },
    },
  },
  { dark: false },
)

const oneLightHighlighting = HighlightStyle.define([
  { tag: tags.keyword, color: '#a626a4' },
  { tag: [tags.name, tags.deleted, tags.character, tags.propertyName, tags.macroName], color: '#e45649' },
  { tag: [tags.function(tags.variableName), tags.labelName], color: '#4078f2' },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: '#986801' },
  { tag: [tags.definition(tags.name), tags.separator], color: '#383a42' },
  { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: '#986801' },
  { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link, tags.special(tags.string)], color: '#0184bc' },
  { tag: [tags.meta, tags.comment], color: '#a0a1a7' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: '#0184bc', textDecoration: 'underline' },
  { tag: tags.heading, fontWeight: 'bold', color: '#e45649' },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: '#986801' },
  { tag: [tags.processingInstruction, tags.string, tags.inserted], color: '#50a14f' },
  { tag: tags.invalid, color: '#986801' },
])

const oneLight: Extension = [oneLightTheme, syntaxHighlighting(oneLightHighlighting)]

export function getThemeExtension(themeName: ThemeName): Extension {
  if (themeName === 'one-dark') {
    return [baseTheme, oneDark]
  }
  return [baseTheme, oneLight]
}
