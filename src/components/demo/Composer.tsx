'use client'

import { useState } from 'react'
import { Send } from 'lucide-react'

/**
 * The visitor's way in.
 *
 * The prompts matter as much as the box. Someone who opens a stranger's demo
 * does not know what to type, and a blank field is where they leave. Each
 * prompt below names a technology the seeded conversations already hold, so
 * the first thing a visitor sends draws an edge rather than a lone dot.
 */

const PROMPTS = [
  'We run PostgreSQL on Kubernetes in production.',
  'I picked Rust for the parser because of the borrow checker.',
  'Docker Compose is enough for our local setup.',
]

export function Composer({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void
  disabled?: boolean
}) {
  const [text, setText] = useState('')

  function submit(value: string) {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setText('')
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => submit(p)}
            disabled={disabled}
            style={{
              fontSize: 11,
              padding: '5px 10px',
              borderRadius: 999,
              border: '1px solid var(--border)',
              background: 'var(--white)',
              color: 'var(--ink2)',
              cursor: disabled ? 'default' : 'pointer',
              textAlign: 'left',
              fontFamily: 'inherit',
            }}
          >
            {p}
          </button>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'flex-end',
          border: '1px solid var(--border)',
          borderRadius: 10,
          background: 'var(--white)',
          padding: 8,
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line — the convention every
            // chat box the visitor already uses follows.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit(text)
            }
          }}
          rows={2}
          placeholder="Write anything a developer might say…"
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            resize: 'none',
            fontSize: 13,
            lineHeight: 1.5,
            fontFamily: 'inherit',
            color: 'var(--ink)',
            background: 'transparent',
          }}
        />
        <button
          onClick={() => submit(text)}
          disabled={disabled || !text.trim()}
          aria-label="Send message"
          style={{
            width: 32,
            height: 32,
            flexShrink: 0,
            borderRadius: 8,
            border: 'none',
            background: text.trim() ? 'var(--violet)' : 'var(--border2)',
            color: text.trim() ? '#fff' : 'var(--ink3)',
            cursor: text.trim() ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  )
}
