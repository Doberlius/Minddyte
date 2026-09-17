'use client'

import { useEffect, useMemo, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { AtPicker } from './AtPicker'

type Chat = { id: string; title: string; nodeCount: number }

// Disk, not RAM: ~5-10 MB per origin and this holds one uuid. React state is
// what lives in memory, and is exactly why a reload currently loses your chat.
// The natural upgrade is the URL (/?chat=<uuid>), once the sidebar effort
// brings routing — it survives reload AND makes a chat linkable.
const SESSION_KEY = 'minddyte.sessionId'

export function NeuralChat() {
  const [input, setInput] = useState('')
  const [chats, setChats] = useState<Chat[]>([])
  const [tagged, setTagged] = useState<Chat[]>([])
  const [mode, setMode] = useState<'focus' | 'explore'>('explore')
  const [sessionId, setSessionId] = useState<string | null>(null)

  // localStorage is not available during server rendering, so it is read in an
  // effect rather than in the initial state.
  useEffect(() => {
    setSessionId(localStorage.getItem(SESSION_KEY))
  }, [])

  useEffect(() => {
    fetch('/api/sessions')
      // fetch does not reject on 4xx, and the error body parses as valid JSON —
      // without the r.ok check, setChats would receive an object and the picker
      // would throw on .filter().
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setChats(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  const atQuery = useMemo(() => {
    const m = input.match(/@(\S*)$/)
    return m ? m[1] : null
  }, [input])

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  })

  // Ticket 08: click New chat and nothing is written. Type and still nothing.
  // SEND, and the row appears. Walking away leaves no `New Session` debris,
  // which the eager version would have needed a guard to prevent.
  const submit = async () => {
    const text = input.trim()
    if (!text || status !== 'ready') return

    let sid = sessionId
    if (!sid) {
      const res = await fetch('/api/sessions', { method: 'POST' })
      if (!res.ok) {
        // Standing rule: never fail blankly. Losing the message the user typed
        // without saying why is the worst outcome here, so the input is kept.
        console.error('[chat] could not create a chat', res.status)
        return
      }
      sid = (await res.json()).id as string
      localStorage.setItem(SESSION_KEY, sid)
      setSessionId(sid)
    }

    // mode, taggedChatIds and sessionId must all be sent PER CALL: the
    // transport's constructor body is frozen at mount, and sessionId is null
    // then. Per-call body is merged over it at send time.
    sendMessage(
      { text },
      { body: { sessionId: sid, mode, taggedChatIds: tagged.map((t) => t.id) } },
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
          <AtPicker chats={chats.filter((c) => c.id !== sessionId)} query={atQuery} onPick={(c) => {
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
