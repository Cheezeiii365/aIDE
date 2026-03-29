import { Compartment } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

export const wrapCompartment = new Compartment()

let wrapEnabled = false

export function isWrapEnabled(): boolean {
  return wrapEnabled
}

export function toggleWrap(): boolean {
  wrapEnabled = !wrapEnabled
  return wrapEnabled
}

export function getWrapExtension(enabled: boolean): Extension {
  return enabled ? EditorView.lineWrapping : []
}
