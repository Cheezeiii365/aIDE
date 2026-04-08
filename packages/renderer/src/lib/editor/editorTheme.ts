import { Compartment } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import type { ThemeDefinition } from '@aide/shared'

export const themeCompartment = new Compartment()
export const editorMetricsCompartment = new Compartment()

const baseTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
})

function token(theme: ThemeDefinition, key: string, fallback: string): string {
  return theme.tokens[key] ?? fallback
}

/**
 * Produce editor typography metrics derived from a base font size.
 *
 * @param fontSize - Base font size in pixels (number, interpreted as px)
 * @returns An object containing `fontSize` (the input value) and `lineHeight` (a pixel string rounded to `Math.round(fontSize * 1.6)`), e.g. `{ fontSize: 13, lineHeight: "21px" }`
 */
export function getEditorMetrics(fontSize: number): { fontSize: number; lineHeight: string } {
  return {
    fontSize,
    lineHeight: `${Math.round(fontSize * 1.6)}px`,
  }
}

/**
 * Create a CodeMirror theme extension that applies the editor's font size and line height.
 *
 * @param fontSize - Base font size in pixels to apply to the editor
 * @returns An EditorView theme extension that sets `fontSize` on the editor root, content, gutters and gutter elements, and applies a computed `lineHeight` to lines and those elements; the `lineHeight` is computed as `Math.round(fontSize * 1.6)` pixels.
 */
export function getEditorMetricsExtension(fontSize: number): Extension {
  const metrics = getEditorMetrics(fontSize)
  return EditorView.theme({
    '&': {
      fontSize: `${metrics.fontSize}px`,
      lineHeight: metrics.lineHeight,
    },
    '.cm-content': {
      fontSize: `${metrics.fontSize}px`,
      lineHeight: metrics.lineHeight,
    },
    '.cm-line': {
      lineHeight: metrics.lineHeight,
    },
    '.cm-gutters': {
      fontSize: `${metrics.fontSize}px`,
      lineHeight: metrics.lineHeight,
    },
    '.cm-gutterElement': {
      fontSize: `${metrics.fontSize}px`,
      lineHeight: metrics.lineHeight,
    },
  })
}

function createHighlighting(theme: ThemeDefinition): HighlightStyle {
  return HighlightStyle.define([
    { tag: tags.keyword, color: token(theme, '--syntax-keyword', '#c678dd') },
    {
      tag: [tags.name, tags.deleted, tags.character, tags.propertyName, tags.macroName],
      color: token(theme, '--syntax-tag', '#e06c75'),
    },
    {
      tag: [tags.function(tags.variableName), tags.labelName],
      color: token(theme, '--syntax-fn', '#61afef'),
    },
    {
      tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)],
      color: token(theme, '--syntax-number', '#d19a66'),
    },
    {
      tag: [tags.definition(tags.name), tags.separator],
      color: token(theme, '--text-primary', '#abb2bf'),
    },
    {
      tag: [
        tags.typeName,
        tags.className,
        tags.number,
        tags.changed,
        tags.annotation,
        tags.modifier,
        tags.self,
        tags.namespace,
      ],
      color: token(theme, '--syntax-number', '#d19a66'),
    },
    {
      tag: [
        tags.operator,
        tags.operatorKeyword,
        tags.url,
        tags.escape,
        tags.regexp,
        tags.link,
        tags.special(tags.string),
      ],
      color: token(theme, '--syntax-attr', '#528bff'),
    },
    { tag: [tags.meta, tags.comment], color: token(theme, '--syntax-comment', '#5c6370') },
    { tag: tags.strong, fontWeight: 'bold' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    {
      tag: tags.link,
      color: token(theme, '--syntax-attr', '#528bff'),
      textDecoration: 'underline',
    },
    { tag: tags.heading, fontWeight: 'bold', color: token(theme, '--syntax-tag', '#e06c75') },
    {
      tag: [tags.atom, tags.bool, tags.special(tags.variableName)],
      color: token(theme, '--syntax-number', '#d19a66'),
    },
    {
      tag: [tags.processingInstruction, tags.string, tags.inserted],
      color: token(theme, '--syntax-string', '#98c379'),
    },
    { tag: tags.invalid, color: token(theme, '--text-error', '#ff6b6b') },
  ])
}

function createEditorViewTheme(theme: ThemeDefinition): Extension {
  const accent = token(theme, '--accent', '#528bff')
  const selection = token(theme, '--bg-selection', 'rgba(82, 139, 255, 0.15)')
  const elevated = token(theme, '--bg-elevated', '#21252b')
  const hover = token(theme, '--bg-hover', 'rgba(255, 255, 255, 0.04)')
  const border = token(theme, '--border-base', '#181a1f')
  const tooltipBorder = token(theme, '--border-subtle', '#2e333b')

  return EditorView.theme(
    {
      '&': {
        color: token(theme, '--text-primary', '#abb2bf'),
        backgroundColor: token(theme, '--bg-base', '#282c34'),
      },
      '.cm-content': { caretColor: accent },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: accent },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
        {
          backgroundColor: selection,
        },
      '.cm-searchMatch': {
        backgroundColor: token(theme, '--bg-info', selection),
        outline: `1px solid ${accent}`,
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: token(theme, '--bg-info-hover', hover),
      },
      '.cm-activeLine': { backgroundColor: hover },
      '.cm-selectionMatch': { backgroundColor: selection },
      '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
        backgroundColor: selection,
      },
      '.cm-gutters': {
        backgroundColor: elevated,
        color: token(theme, '--text-muted', '#565c68'),
        border: 'none',
      },
      '.cm-activeLineGutter': { backgroundColor: hover },
      '.cm-foldPlaceholder': {
        backgroundColor: 'transparent',
        border: 'none',
        color: token(theme, '--text-muted', '#565c68'),
      },
      '.cm-tooltip': {
        border: `1px solid ${tooltipBorder}`,
        backgroundColor: elevated,
      },
      '.cm-panels': {
        backgroundColor: elevated,
        color: token(theme, '--text-primary', '#abb2bf'),
        borderBottom: `1px solid ${border}`,
      },
      '.cm-tooltip .cm-tooltip-arrow:before': {
        borderTopColor: tooltipBorder,
        borderBottomColor: tooltipBorder,
      },
      '.cm-tooltip .cm-tooltip-arrow:after': {
        borderTopColor: elevated,
        borderBottomColor: elevated,
      },
      '.cm-tooltip-autocomplete': {
        '& > ul > li[aria-selected]': {
          backgroundColor: selection,
          color: token(theme, '--text-primary', '#abb2bf'),
        },
      },
    },
    { dark: theme.appearance === 'dark' },
  )
}

export function getThemeExtension(theme: ThemeDefinition): Extension {
  return [baseTheme, createEditorViewTheme(theme), syntaxHighlighting(createHighlighting(theme))]
}
