import { useRef, useCallback, useState } from 'react'
import type { ChatMode, ChatSessionStatus } from '@aide/shared'

interface ChatInputProps {
  onSend: (content: string) => void
  onStop: () => void
  status: ChatSessionStatus
  mode: ChatMode
}

const PLACEHOLDERS: Record<ChatMode, string> = {
  ask: 'Ask a question...',
  edit: 'Describe changes...',
  agent: 'What should I do?',
}

export function ChatInput({ onSend, onStop, status, mode }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState('')
  const isActive = status !== 'idle'

  const resize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(e.target.value)
      resize()
    },
    [resize],
  )

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || isActive) return
    onSend(trimmed)
    setValue('')
    // Reset textarea height
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.style.height = 'auto'
      }
    })
  }, [value, isActive, onSend])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      } else if (e.key === 'Escape') {
        textareaRef.current?.blur()
      }
    },
    [handleSend],
  )

  return (
    <div className="chat-input">
      <textarea
        ref={textareaRef}
        className="chat-input__textarea"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={PLACEHOLDERS[mode]}
        rows={1}
        disabled={isActive}
      />
      {isActive ? (
        <button className="chat-input__btn-stop" onClick={onStop} title="Stop">
          <div className="chat-input__btn-stop__icon" />
        </button>
      ) : (
        <button
          className="chat-input__btn-send"
          onClick={handleSend}
          disabled={!value.trim()}
        >
          Send
        </button>
      )}
    </div>
  )
}
