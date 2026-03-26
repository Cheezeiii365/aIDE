/**
 * Command system types shared between main and renderer.
 */

export interface CommandDefinition {
  id: string
  label: string
  keybinding?: string
  when?: string
  category?: string
}
