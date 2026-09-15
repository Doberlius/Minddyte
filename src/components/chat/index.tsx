'use client'

import { useEffect, useMemo, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { AtPicker } from './AtPicker'

type Chat = { id: string; title: string; nodeCount: number }

// M1 uses a fixed dev user and session until auth lands (spec §12, out of scope).
const DEV_SESSION = process.env.NEXT_PUBLIC_DEV_SESSION_ID ?? ''

export function NeuralChat() {
  const [input, setInput] = useState('')
  const [chats, setChats] = useState<Chat[]>([])
  const [tagged, setTagged] = useState<Chat[]>([])
  const [mode, setMode] = useState<'focus' | 'explore'>('explore')

  useEffect(() => {
    fetch('/api/sessions')
      // fetch does not reject on 4xx, and the error body parses as valid JSON —
      // without the r.ok check, setChats would receive an object and the picker
      // would throw on .filter().
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setChats(Array.isArray(data) ? data.filter((c) => c.id !== DEV_SESSION) : []))
      .catch(() => {})
  }, [])

  const atQuery = useMemo(() => {
    const m = input.match(/@(\S*)$/)
    return m ? m[1] : null
  }, [input])

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: {
        sessionId: DEV_SESSION,
      },
    }),
  })

  const submit = () => {
    const text = input.trim()
    if (!text || status !== 'ready') return
    // mode and taggedChatIds must be sent per-call: useChat builds its Chat (and
    // the transport that owns the constructor `body`) once at mount and never
    // rebuilds it, so anything baked into the transport body is frozen at its
    // first-render value. Per-call body is merged over it at send time.
    sendMessage(
      { text },
      { body: { mode, taggedChatIds: tagged.map((t) => t.id) } },
    )
    setInput('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '26px 30px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {messages.map((m) => (
          <div key={m.id} style={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: 640, fontSize: 13.5, lineHeight: 1.65,
            background: m.role === 'user' ? 'var(--white)' : 'transparent',
            border: m.role === 'user' ? '1px solid var(--border)' : 'none',
            borderRadius: 14, padding: m.role === 'user' ? '11px 15px' : 0,
          }}>
            {m.parts.filter((p) => p.type === 'text').map((p) => p.text).join('')}
          </div>
        ))}
        {status === 'streaming' && <div style={{ fontSize: 12, color: 'var(--ink3)' }}>…</div>}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', background: 'var(--white)', padding: '11px 20px 15px', position: 'relative' }}>
        {atQuery !== null && (
          <AtPicker chats={chats} query={atQuery} onPick={(c) => {
            if (!tagged.find((t) => t.id === c.id)) setTagged([...tagged, c])
            setInput(input.replace(/@\S*$/, ''))
          }} />
        )}

        {tagged.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 9, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10.5, color: 'var(--ink3)' }}>Using —</span>
            {tagged.map((t) => (
              <span key={t.id} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 20,
                background: 'var(--violet-l)', border: '1px solid var(--violet-m)', color: 'var(--violet)' }}>
                {t.title}
                <button onClick={() => setTagged(tagged.filter((x) => x.id !== t.id))}
                  style={{ marginLeft: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>×</button>
              </span>
            ))}
          </div>
        )}

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
          placeholder="Ask anything — @ to bring in a past chat"
          style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 11, padding: '11px 14px',
            fontSize: 13.5, background: 'var(--bg)', resize: 'none', height: 62, outline: 'none', fontFamily: 'inherit' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 8 }}>
          <button onClick={() => setMode(mode === 'focus' ? 'explore' : 'focus')}
            style={{ fontSize: 11, padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 7,
              background: 'none', cursor: 'pointer' }}>
            /mode {mode}
          </button>
          <span style={{ fontSize: 10.5, color: 'var(--ink3)' }}>
            Nothing is saved to your graph unless you use @ or a command.
          </span>
          <button onClick={submit} disabled={status !== 'ready'} style={{ marginLeft: 'auto', background: 'var(--violet)', color: '#fff',
            border: 'none', borderRadius: 8, padding: '7px 17px', fontSize: 12.5, fontWeight: 600,
            opacity: status === 'ready' ? 1 : 0.5, cursor: status === 'ready' ? 'pointer' : 'not-allowed' }}>
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
