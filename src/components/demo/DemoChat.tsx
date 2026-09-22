'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Sparkles } from 'lucide-react'
import { AtPicker } from '@/components/chat/AtPicker'
import type { DemoChat as Chat, DemoGraph } from '@/demo/graph'
import type { ChatSummary } from '@/components/layout/Sidebar'
import type { Extraction } from '@/app/demo/page'

/**
 * The Chat tab.
 *
 * Deliberately the application's chat surface — a visitor should not be able
 * to tell the chrome apart, because it is the same chrome.
 *
 * One thing is added that the application does not have: after each message
 * the transcript shows what the extractor took from it. Without that, a
 * sentence connecting to nothing looks like a broken page, when in fact the
 * gate did its job and said no.
 *
 * The `/mode` pill and the `@` picker are the app's, and they are live here.
 * They were dropped from an earlier pass for a good reason — an inert chip of
 * product jargon beside the box you are supposed to type in — but the fix for
 * a control that does nothing is to make it do something, and both now decide
 * what the message is sent with. The transcript reports the result, so the
 * difference between focus and explore is visible in one message.
 */

const PROMPTS = [
  'We run PostgreSQL on Kubernetes in production.',
  'I picked Rust for the parser because of the borrow checker.',
  'Docker Compose is enough for our local setup.',
]

function Suggestion({ text, onPick }: { text: string; onPick: (text: string) => void }) {
  return (
    <button className="demo-prompt" onClick={() => onPick(text)}>
      <span>{text}</span>
      <ArrowRight size={13} />
    </button>
  )
}

function Indexed({
  extraction,
  onSeeGraph,
}: {
  extraction: Extraction
  onSeeGraph: () => void
}) {
  const linked = new Set(extraction.connected)

  return (
    <div style={{ alignSelf: 'flex-start', maxWidth: 640, marginTop: -6 }}>
      {/* Said here rather than in the reply itself, because the reply is kept
          as this conversation's memory and the Archive would then fill up with
          the demo explaining itself. */}
      {extraction.asked && (
        <p
          style={{
            margin: '0 0 12px',
            fontSize: 12,
            lineHeight: 1.6,
            color: 'var(--ink2)',
            paddingLeft: 11,
            borderLeft: '1px solid var(--violet-m)',
          }}
        >
          That was a question, and nothing here can answer it — the demo runs no model. What it
          does instead is show you what your words did to the graph.
        </p>
      )}

      <div className="demo-eyebrow" style={{ marginBottom: 8 }}>
        <Sparkles size={11} />
        added to your graph
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {extraction.auto.length === 0 && (
          // An empty result is the gate working, not a failure — but it has to
          // say so, and say what to do instead.
          <span style={{ fontSize: 12.5, color: 'var(--ink2)' }}>
            Nothing firm enough to index here. Name a tool or a library — Postgres, Rust,
            Kubernetes — and the extractor has something to hold on to.
          </span>
        )}
        {extraction.auto.map((label) => (
          <span key={label} className={`demo-chip${linked.has(label) ? ' is-shared' : ''}`}>
            {label}
          </span>
        ))}
      </div>

      {extraction.connected.length > 0 && (
        <div style={{ marginTop: 9, fontSize: 11.5, color: 'var(--ink3)', lineHeight: 1.55 }}>
          Filled violet means another conversation here already held that concept, so the two
          are linked now.
        </div>
      )}

      {extraction.suggested.length > 0 && (
        <div style={{ marginTop: 9, fontSize: 11.5, color: 'var(--ink3)', lineHeight: 1.55 }}>
          Held back: {extraction.suggested.join(', ')} — a plain lowercase word is a real concept
          only 29% of the time, so it is suggested rather than indexed.
        </div>
      )}

      {/* The point of the two modes, made visible: this is the memory the
          message would have carried to a model, and why each piece of it came
          back. Without this, focus and explore were settings with no effect. */}
      <div style={{ marginTop: 11, fontSize: 11.5, lineHeight: 1.6, color: 'var(--ink3)' }}>
        <span style={{ fontWeight: 600, color: 'var(--ink2)' }}>/mode {extraction.mode}</span>
        {extraction.reached.length === 0 ? (
          extraction.mode === 'focus'
            ? ' — sent with no memory. Focus reaches nothing you did not tag.'
            : ' — sent with no memory. Nothing here shares a concept with this yet.'
        ) : (
          <>
            {' '}— sent with the memory of{' '}
            {extraction.reached.map((r, i) => (
              <span key={r.id}>
                {i > 0 && ', '}
                <span style={{ color: 'var(--violet)', fontWeight: 600 }}>{r.title}</span>
                <span>
                  {r.kind === 'tagged'
                    ? ' (you brought it in)'
                    : ` (shares ${r.shared.slice(0, 2).join(', ')})`}
                </span>
              </span>
            ))}
            .
          </>
        )}
      </div>

      {extraction.connected.length > 0 && (
        <button
          onClick={onSeeGraph}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            marginTop: 11,
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--violet)',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          See it on the Neural Brain
          <ArrowRight size={13} />
        </button>
      )}
    </div>
  )
}

export function DemoChat({
  chat,
  graph,
  extractions,
  isMine,
  chats,
  mode,
  onModeChange,
  tagged,
  onTaggedChange,
  onSend,
  onSeeGraph,
}: {
  /** The open conversation — any of them, not only the visitor's. */
  chat: Chat | undefined
  graph: DemoGraph
  extractions: Record<number, Extraction>
  /** Whether the visitor started this one, which the header says out loud. */
  isMine: boolean
  /** Every other conversation, for the @ picker. */
  chats: ChatSummary[]
  mode: 'focus' | 'explore'
  onModeChange: (mode: 'focus' | 'explore') => void
  /** Conversations brought in by hand, applied to the next message only. */
  tagged: string[]
  onTaggedChange: (ids: string[]) => void
  onSend: (text: string) => void
  onSeeGraph: () => void
}) {
  const [input, setInput] = useState('')
  const [used, setUsed] = useState<string[]>([])
  const transcript = useRef<HTMLDivElement>(null)
  const messages = chat?.messages ?? []
  const concepts = chat ? graph.nodes.filter((n) => n.chatIds.includes(chat.id)).length : 0

  /** An unfinished @mention at the end of the box opens the picker. */
  const atQuery = useMemo(() => {
    const m = input.match(/@(\S*)$/)
    return m ? m[1] : null
  }, [input])

  /**
   * Follow the newest turn.
   *
   * Without this, sending a message from a transcript already taller than the
   * pane appends the reply and the extraction below the fold: the visitor
   * presses Send, the view does not move, and the only reasonable conclusion
   * is that nothing happened. The reply is the payoff of the whole demo, so it
   * cannot be something you have to go looking for.
   */
  useEffect(() => {
    const pane = transcript.current
    if (!pane) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    pane.scrollTo({ top: pane.scrollHeight, behavior: still ? 'auto' : 'smooth' })
    // Also on the chat's identity: opening a conversation from the sidebar
    // should land at its newest turn, not at the top of a transcript whose
    // last line is the one worth reading.
  }, [messages.length, chat?.id])

  function submit(value: string) {
    const text = value.trim()
    if (!text) return
    onSend(text)
    setUsed((u) => (PROMPTS.includes(text) ? [...u, text] : u))
    setInput('')
  }

  // Kept available after the first message, because inventing a second sentence
  // that the extractor will actually bite on is the point where a visitor
  // stalls. Withdrawn once they are clearly steering themselves.
  const remaining = PROMPTS.filter((p) => !used.includes(p))
  const turns = messages.filter((m) => m.role === 'user').length
  const showMore = turns > 0 && turns < 3 && remaining.length > 0

  return (
    <div className="demo-pane" style={{ width: '100%', background: 'var(--bg)' }}>
      {/* The app's chat header, carrying the same two facts: what this
          conversation is called, and how much of the graph it holds. */}
      <header className="chat-head">
        <span className="t">{chat?.title ?? 'New chat'}</span>
        <span className="meta tnum">
          {chat ? `${isMine ? 'yours · ' : ''}${concepts} concept${concepts === 1 ? '' : 's'}` : ''}
        </span>
      </header>

      <div ref={transcript} className="thread">
        <div className="thread-col">
        {messages.length === 0 ? (
          <div style={{ margin: 'auto', maxWidth: 520, textAlign: 'center' }}>
            <h1
              style={{
                fontFamily: "'Fraunces',serif",
                fontSize: 27,
                fontWeight: 500,
                letterSpacing: '-.02em',
                lineHeight: 1.25,
                margin: '0 0 10px',
              }}
            >
              <span className="tnum">{graph.chats.length}</span> conversations are already here
            </h1>
            <p style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--ink2)', margin: '0 0 22px' }}>
              Nobody filed or tagged any of them, yet they are connected — by the
              concepts they happen to share. Say something and watch yours join.
            </p>
            <div className="demo-eyebrow" style={{ justifyContent: 'center', marginBottom: 10 }}>
              press one to send it
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {PROMPTS.map((p) => (
                <Suggestion key={p} text={p} onPick={submit} />
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} style={{ display: 'contents' }}>
              <div
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: 640,
                  fontSize: 13.5,
                  lineHeight: 1.65,
                  background: m.role === 'user' ? 'var(--white)' : 'transparent',
                  border: m.role === 'user' ? '1px solid var(--border)' : 'none',
                  borderRadius: 14,
                  padding: m.role === 'user' ? '11px 15px' : 0,
                  color: m.role === 'user' ? 'var(--ink)' : 'var(--ink2)',
                }}
              >
                {m.content}
              </div>
              {m.role === 'assistant' && extractions[i - 1] && (
                <Indexed extraction={extractions[i - 1]} onSeeGraph={onSeeGraph} />
              )}
            </div>
          ))
        )}
        </div>
      </div>

      <div className="composer">
        <div className="composer-col">
        {showMore && (
          <div style={{ marginBottom: 10 }}>
            <div className="demo-eyebrow" style={{ marginBottom: 7 }}>
              or try another
            </div>
            {/* The second one is dropped on a phone, where the composer, the
                note and two suggestion pills together were eating the
                transcript they are supposed to be feeding. */}
            <div className="demo-more">
              {remaining.slice(0, 2).map((p) => (
                <button key={p} className="demo-prompt" style={{ width: 'auto' }} onClick={() => submit(p)}>
                  <span>{p}</span>
                  <ArrowRight size={13} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* The @ picker, the app's own component. It pops above the field,
            which is why the column around it is the positioned one. */}
        {atQuery !== null && (
          <AtPicker
            chats={chats.filter((c) => !tagged.includes(c.id))}
            query={atQuery}
            onPick={(c) => {
              if (!tagged.includes(c.id)) onTaggedChange([...tagged, c.id])
              setInput(input.replace(/@\S*$/, ''))
            }}
          />
        )}

        {tagged.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 9, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10.5, color: 'var(--ink3)' }}>Using —</span>
            {tagged.map((id) => {
              const chat = chats.find((c) => c.id === id)
              if (!chat) return null
              return (
                <span
                  key={id}
                  style={{
                    fontSize: 11, padding: '3px 9px', borderRadius: 20,
                    background: 'var(--violet-l)', border: '1px solid var(--violet-m)', color: 'var(--violet)',
                  }}
                >
                  {chat.title}
                  <button
                    onClick={() => onTaggedChange(tagged.filter((x) => x !== id))}
                    aria-label={`Stop using ${chat.title}`}
                    style={{ marginLeft: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
                  >
                    ×
                  </button>
                </span>
              )
            })}
          </div>
        )}

        <label className="sr-only" htmlFor="demo-composer">
          Your message
        </label>
        <textarea
          id="demo-composer"
          className="composer-box"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit(input)
            }
          }}
          enterKeyHint="send"
          placeholder="Name a tool you use, or @ a conversation to bring its memory in"
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
          {/* Live now, not decoration. Focus reaches only what you tag; explore
              also reaches conversations sharing a concept. Each message records
              which mode it was sent under, and says so in the transcript. */}
          <button
            onClick={() => onModeChange(mode === 'focus' ? 'explore' : 'focus')}
            aria-label={`Mode: ${mode}. Switch to ${mode === 'focus' ? 'explore' : 'focus'}`}
            title={
              mode === 'explore'
                ? 'Explore: also brings in conversations that share a concept with this one.'
                : 'Focus: brings in nothing you did not @ yourself.'
            }
            style={{
              fontSize: 11, padding: '5px 10px', borderRadius: 7, cursor: 'pointer',
              fontFamily: 'inherit', flexShrink: 0,
              border: `1px solid ${mode === 'explore' ? 'var(--violet-m)' : 'var(--border)'}`,
              background: mode === 'explore' ? 'var(--violet-l)' : 'none',
              color: mode === 'explore' ? 'var(--violet)' : 'var(--ink2)',
              fontWeight: 600,
            }}
          >
            /mode {mode}
          </button>
          <span style={{ fontSize: 11.5, color: 'var(--ink3)', lineHeight: 1.5, minWidth: 0 }}>
            Replies here are written, not generated — the graph is real, and never
            needed a model to build it.
          </span>
          <button className="btn-send" onClick={() => submit(input)} disabled={!input.trim()}>
            Send
          </button>
        </div>
        </div>
      </div>
    </div>
  )
}
