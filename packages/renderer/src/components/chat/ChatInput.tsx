import { useRef, useCallback, useState, useMemo, useEffect } from 'react'
import type { ChatComposerSubmission, ChatMode, ChatSessionStatus } from '@aide/shared'
import { Button } from '../ui/Button'
import {
  buildComposerSubmission,
  CHAT_AUTOCOMPLETE_COMMANDS,
  filterCommandSuggestions,
  filterFileSuggestions,
  getComposerTrigger,
} from '../../lib/chatComposer'

interface ChatInputProps {
  onSend: (payload: ChatComposerSubmission) => void
  onStop: () => void
  status: ChatSessionStatus
  mode: ChatMode
  workspaceRoot?: string
}

export function ChatInput({ onSend, onStop, status, workspaceRoot }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState('')
  const [mentionedFiles, setMentionedFiles] = useState<string[]>([])
  const [allFiles, setAllFiles] = useState<string[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const isActive = status !== 'idle'

  useEffect(() => {
    let cancelled = false
    if (!workspaceRoot) {
      setAllFiles([])
      return () => {
        cancelled = true
      }
    }
    window.api
      .listAllFiles(workspaceRoot)
      .then((files) => {
        if (!cancelled) setAllFiles(files)
      })
      .catch(() => {
        if (!cancelled) setAllFiles([])
      })
    return () => {
      cancelled = true
    }
  }, [workspaceRoot])

  const resize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  const cursor = textareaRef.current?.selectionStart ?? value.length
  const trigger = useMemo(() => getComposerTrigger(value, cursor), [value, cursor])
  const fileSuggestions = useMemo(
    () =>
      trigger?.kind === 'file'
        ? filterFileSuggestions(
            allFiles.filter((file) => !mentionedFiles.includes(file)),
            trigger.query,
          )
        : [],
    [allFiles, mentionedFiles, trigger],
  )
  const commandSuggestions = useMemo(
    () =>
      trigger?.kind === 'command'
        ? filterCommandSuggestions(CHAT_AUTOCOMPLETE_COMMANDS, trigger.query)
        : [],
    [trigger],
  )
  const suggestions = trigger?.kind === 'file' ? fileSuggestions : commandSuggestions

  useEffect(() => {
    setActiveIndex(0)
  }, [trigger?.kind, trigger?.query, suggestions.length])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(e.target.value)
      resize()
    },
    [resize],
  )

  const resetComposer = useCallback(() => {
    setValue('')
    setMentionedFiles([])
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) el.style.height = 'auto'
    })
  }, [])

  const handleSend = useCallback(() => {
    const submission = buildComposerSubmission(value, mentionedFiles)
    if ((!submission.text && submission.mentionedFiles.length === 0) || isActive) return
    onSend(submission)
    resetComposer()
  }, [value, mentionedFiles, isActive, onSend, resetComposer])

  const insertCommand = useCallback(
    (commandId: string) => {
      if (!trigger || trigger.kind !== 'command') return
      const nextValue = `${value.slice(0, trigger.start)}/${commandId} ${value.slice(trigger.end)}`
      setValue(nextValue)
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (!el) return
        const pos = trigger.start + commandId.length + 2
        el.focus()
        el.setSelectionRange(pos, pos)
        resize()
      })
    },
    [trigger, value, resize],
  )

  const insertMention = useCallback(
    (filePath: string) => {
      if (!trigger || trigger.kind !== 'file') return
      const nextValue = `${value.slice(0, trigger.start)}${value.slice(trigger.end)}`
      setValue(nextValue)
      setMentionedFiles((prev) => (prev.includes(filePath) ? prev : [...prev, filePath]))
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (!el) return
        const pos = trigger.start
        el.focus()
        el.setSelectionRange(pos, pos)
        resize()
      })
    },
    [trigger, value, resize],
  )

  const handleSuggestionSelect = useCallback(() => {
    if (!trigger || suggestions.length === 0) return false
    const current = suggestions[Math.min(activeIndex, suggestions.length - 1)]
    if (!current) return false
    if (trigger.kind === 'file') insertMention(current as string)
    else insertCommand((current as (typeof commandSuggestions)[number]).id)
    return true
  }, [activeIndex, commandSuggestions, insertCommand, insertMention, suggestions, trigger])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (trigger && suggestions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setActiveIndex((index) => (index + 1) % suggestions.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length)
          return
        }
        if (e.key === 'Tab') {
          e.preventDefault()
          handleSuggestionSelect()
          return
        }
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault()
          handleSuggestionSelect()
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setValue((current) => current)
          return
        }
      }

      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        handleSend()
      } else if (e.key === 'Escape') {
        textareaRef.current?.blur()
      } else if (e.key === 'Backspace' && !value && mentionedFiles.length > 0) {
        setMentionedFiles((prev) => prev.slice(0, -1))
      }
    },
    [handleSend, handleSuggestionSelect, mentionedFiles.length, suggestions.length, trigger, value],
  )

  return (
    <div className="chat-input-wrap">
      {mentionedFiles.length > 0 && (
        <div className="chat-input__chips">
          {mentionedFiles.map((path) => (
            <button
              key={path}
              type="button"
              className="chat-input__chip"
              onClick={() => setMentionedFiles((prev) => prev.filter((entry) => entry !== path))}
              title={path}
            >
              @{path}
            </button>
          ))}
        </div>
      )}

      <div className="chat-input">
        <textarea
          ref={textareaRef}
          className="chat-input__textarea"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Ask, edit, or build… Use @ for files, / for commands"
          rows={1}
          disabled={isActive}
        />
        {isActive ? (
          <Button variant="danger" size="sm" onClick={onStop} title="Stop">
            Stop
          </Button>
        ) : (
          <Button
            variant="accent"
            size="sm"
            onClick={handleSend}
            disabled={!value.trim() && mentionedFiles.length === 0}
          >
            Send
          </Button>
        )}

        {trigger && suggestions.length > 0 && !isActive && (
          <div className="chat-input__suggestions">
            {trigger.kind === 'file'
              ? fileSuggestions.map((filePath, index) => (
                  <button
                    key={filePath}
                    type="button"
                    className={`chat-input__suggestion${index === activeIndex ? ' chat-input__suggestion--active' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertMention(filePath)}
                  >
                    <span className="chat-input__suggestion-label">
                      @{filePath.split('/').pop() ?? filePath}
                    </span>
                    <span className="chat-input__suggestion-detail">{filePath}</span>
                  </button>
                ))
              : commandSuggestions.map((command, index) => (
                  <button
                    key={command.id}
                    type="button"
                    className={`chat-input__suggestion${index === activeIndex ? ' chat-input__suggestion--active' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertCommand(command.id)}
                  >
                    <span className="chat-input__suggestion-label">{command.label}</span>
                    <span className="chat-input__suggestion-detail">{command.description}</span>
                  </button>
                ))}
          </div>
        )}
      </div>
    </div>
  )
}
