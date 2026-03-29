import { useState, useEffect, useRef, useCallback } from 'react'
import { formatKeybinding } from '../../lib/commands/formatKeybinding'
import { getAllKeybindingRules, setRecordingMode } from '../../lib/commands/KeybindingService'
import { getCommand } from '../../lib/commands/CommandRegistry'

interface KeybindingRecorderProps {
  commandId: string
  onRecord: (keybinding: string) => void
  onCancel: () => void
}

/**
 * Inline keybinding capture widget.
 * Records single-key combos and two-key chords.
 * Enter confirms, Escape cancels, Backspace clears.
 */
export function KeybindingRecorder({ commandId, onRecord, onCancel }: KeybindingRecorderProps) {
  const [firstChord, setFirstChord] = useState<string | null>(null)
  const [currentDisplay, setCurrentDisplay] = useState('Press desired key combination...')
  const [conflict, setConflict] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const pendingKeybinding = useRef<string | null>(null)

  // Suppress global shortcut dispatch while recording
  useEffect(() => {
    setRecordingMode(true)
    return () => setRecordingMode(false)
  }, [])

  const buildKeybindingString = useCallback((e: KeyboardEvent): string | null => {
    const key = e.key
    // Ignore bare modifier presses
    if (['Meta', 'Control', 'Shift', 'Alt'].includes(key)) return null

    const tokens: string[] = []
    if (e.metaKey) tokens.push('Cmd')
    if (e.ctrlKey) tokens.push('Ctrl')
    if (e.shiftKey) tokens.push('Shift')
    if (e.altKey) tokens.push('Alt')

    // Normalise key name
    let keyName = key
    if (key === ' ') keyName = 'Space'
    else if (key.length === 1) keyName = key.toUpperCase()
    else if (key === 'ArrowUp') keyName = 'Up'
    else if (key === 'ArrowDown') keyName = 'Down'
    else if (key === 'ArrowLeft') keyName = 'Left'
    else if (key === 'ArrowRight') keyName = 'Right'

    tokens.push(keyName)
    return tokens.join('+')
  }, [])

  const checkConflict = useCallback((keybinding: string): string | null => {
    const rules = getAllKeybindingRules()
    for (const entry of rules) {
      if (entry.suppressed) continue
      if (entry.rule.command === commandId) continue
      if (entry.rule.key.toLowerCase() === keybinding.toLowerCase()) {
        const cmd = getCommand(entry.rule.command)
        const label = cmd ? cmd.label : entry.rule.command
        const category = cmd?.category
        return `${category ? category + ': ' : ''}${label}`
      }
    }
    return null
  }, [commandId])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      // Escape cancels
      if (e.key === 'Escape') {
        onCancel()
        return
      }

      // Enter confirms if we have something recorded
      if (e.key === 'Enter' && pendingKeybinding.current) {
        onRecord(pendingKeybinding.current)
        return
      }

      // Backspace clears
      if (e.key === 'Backspace' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setFirstChord(null)
        setCurrentDisplay('Press desired key combination...')
        setConflict(null)
        pendingKeybinding.current = null
        return
      }

      const combo = buildKeybindingString(e)
      if (!combo) return

      if (firstChord) {
        // Second part of chord
        const full = `${firstChord} ${combo}`
        pendingKeybinding.current = full
        setCurrentDisplay(formatKeybinding(full))
        setConflict(checkConflict(full))
        setFirstChord(null)
      } else {
        // First key — could be standalone or start of chord
        pendingKeybinding.current = combo
        setFirstChord(combo)
        setCurrentDisplay(formatKeybinding(combo) + '  (chord: press next key, or Enter to confirm)')
        setConflict(checkConflict(combo))
      }
    }

    // Use capture to intercept before KeybindingService
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [firstChord, buildKeybindingString, checkConflict, onRecord, onCancel])

  // Auto-focus container
  useEffect(() => {
    containerRef.current?.focus()
  }, [])

  return (
    <div ref={containerRef} className="keybinding-recorder" tabIndex={-1}>
      <div className="keybinding-recorder__input">
        {currentDisplay}
      </div>
      {conflict && (
        <div className="keybinding-recorder__conflict">
          Conflicts with: {conflict}
        </div>
      )}
      <div className="keybinding-recorder__hint">
        Enter to confirm · Escape to cancel · Backspace to clear
      </div>
    </div>
  )
}
