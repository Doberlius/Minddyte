'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { UsageGauge } from './UsageGauge'
import { DefaultChatTransport } from 'ai'
import { AlertCircle } from 'lucide-react'
import { AtPicker } from './AtPicker'
import { CommandPicker } from './CommandPicker'
import { ModelPicker } from './ModelPicker'
import { classifyChatFailure } from '@/lib/chat-error'
import type { ChatSummary } from '@/components/layout/Sidebar'

type StoredMessage = { id: string; role: 'user' | 'assistant'; content: string }

/** One tag, on disk, so a choice survives a reload the way the open chat does. */
const MODEL_KEY = 'minddyte.modelId'

export function NeuralChat({
  chats,
  activeChat,
  sessionId,
  onSessionChange,
  onChatsChanged,
}: {
  chats: ChatSummary[]
  /** The open chat's row, for the header. Null while composing a new one. */
  activeChat: ChatSummary | null
  /** `undefined` until the shell has read localStorage; null means new chat. */
  sessionId: string | null | undefined
  onSessionChange: (id: string | null) => void
  onChatsChanged: () => void
}) {
  const [input, setInput] = useState('')
  const [tagged, setTagged] = useState<ChatSummary[]>([])
  const [mode, setMode] = useState<'focus' | 'explore'>('explore')
  const [opening, setOpening] = useState(false)
  /**
   * Why the last send did not go through.
   *
   * A failed send used to say nothing at all: the message vanished from the
   * transcript and the button stopped responding, which reads as the app
   * being broken rather than as one request failing.
   */
  const [failure, setFailure] = useState<string | null>(null)
  /**
   * The model to answer with, remembered per browser.
   *
   * null means "let the server pick", which is what `resolveModel` does when
   * the request names nothing. Read in an effect because localStorage does not
   * exist during server rendering.
   */
  const [model, setModel] = useState<string | null>(null)

  useEffect(() => {
    try {
      setModel(localStorage.getItem(MODEL_KEY))
    } catch {
      // Blocked storage is not worth a broken composer; automatic still works.
    }
  }, [])

  function chooseModel(id: string | null) {
    setModel(id)
    try {
      if (id) localStorage.setItem(MODEL_KEY, id)
      else localStorage.removeItem(MODEL_KEY)
    } catch {}
  }

  const atQuery = useMemo(() => {
    const m = input.match(/@(\S*)$/)
    return m ? m[1] : null
  }, [input])

  /**
   * The `/` command list, anchored to the START of the message.
   *
   * `@` names a thing inside what you are saying and so can appear anywhere;
   * a command is not part of a sentence, it is instead of one. Dismissed by
   * hand as well, because a slash is also just a character someone may want to
   * type — `and/or` opens nothing, but a message that begins with one would.
   */
  const [slashOff, setSlashOff] = useState(false)
  const slashQuery = useMemo(() => {
    const m = input.match(/^\/([a-z ]*)$/i)
    return m ? m[1] : null
  }, [input])
  const showCommands = slashQuery !== null && !slashOff

  // Typing past a dismissal, or clearing the box, offers the list again.
  useEffect(() => {
    if (slashQuery === null) setSlashOff(false)
  }, [slashQuery])

  const { messages, sendMessage, status, setMessages, clearError } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
    // ai-sdk's transport wraps any non-2xx response in a plain Error whose
    // `message` IS the raw response body text (see HttpChatTransport: `throw
    // new Error(await response.text())`) — so the ONLY way to tell "your
    // sessionId is gone, start over" apart from "the model call failed" is to
    // parse that text back out and look for the marker /api/chat put there.
    onError: (err) => {
      const failed = classifyChatFailure(err.message)

      // NOTE: recovering the status does NOT happen here. See the effect below.

      // useChat pushes the message into `messages` optimistically, before the
      // request is even sent. It did not land, so it comes back out of the
      // transcript — but the text itself is never thrown away. The standing
      // rule is not to silently discard what someone typed, so it goes back in
      // the box, ready to send again.
      setMessages((prev) => {
        const sent = prev[prev.length - 1]
        const text = sent?.parts.filter((p) => p.type === 'text').map((p) => p.text).join('') ?? ''
        if (text) setInput(text)
        return prev.slice(0, -1)
      })

      if (failed.kind === 'session_not_found') {
        // The chat this browser remembers is gone (db:reset, a deleted chat, a
        // restored export all look the same from here). Forget it so the very
        // next send lazily creates a fresh one instead of retrying the same
        // dead id forever.
        onSessionChange(null)
        setFailure('That conversation no longer exists. Send again to start a new one.')
        return
      }

      setFailure(failed.message)
    },
  })

  /**
   * Let the composer recover from a failed send.
   *
   * `status` latches to 'error' and the Send button is `disabled` while it
   * does, so one failure used to kill the composer until the page was
   * reloaded. Reproduced in a browser: a single 503 and the button never came
   * back.
   *
   * The obvious place for this is `onError`, and that is where it used to be —
   * where it could never work. ai-sdk calls the callback BEFORE it records the
   * failure:
   *
   *     if (this.onError && err instanceof Error) this.onError(err)
   *     this.setStatus({ status: "error", error: err })
   *
   * and `clearError` is a no-op unless the status is already 'error'
   * (`ai/dist/index.mjs`, both the reconnect path and the main catch). So the
   * call inside the callback always ran one step too early, silently.
   *
   * Watching the status instead is immune to that ordering. The failure itself
   * is not swallowed — it is on screen, in `failure`, next to the text that is
   * back in the box.
   */
  useEffect(() => {
    if (status === 'error') clearError()
  }, [status, clearError])

  /**
   * Which chat the transcript on screen belongs to.
   *
   * `messages` lives in memory, so switching chats has to refill it from the
   * server — but the same effect must NOT refill it when the id changed
   * because we just created this chat by sending into it. That message is
   * already on screen, optimistically, and reloading would wipe it and put it
   * back a second later. Claiming the id before the switch is what separates
   * the two cases.
   */
  const loadedFor = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (sessionId === undefined) return // the shell has not read localStorage yet
    if (loadedFor.current === sessionId) return
    loadedFor.current = sessionId

    // Tags and any failure belong to the chat you were in, not the one you
    // just opened.
    setTagged([])
    setFailure(null)

    /**
     * Decided HERE, once, for every path out of this effect — not left to the
     * `.finally` below.
     *
     * The flag hides the whole transcript, and it used to be cleared in one
     * place only: when a load settled while it was still the current one.
     * Switching to a new chat mid-load took the `!sessionId` return above that
     * line, and the fetch it left behind saw `cancelled` and skipped the
     * clear — so the flag stayed true and the pane read "Opening this chat…"
     * until the page was reloaded. Reproduced in a browser: open a chat, press
     * New chat before it settles, and it never comes back.
     *
     * There is nothing to load for a new chat, so there is nothing to wait for.
     */
    setOpening(Boolean(sessionId))

    if (!sessionId) {
      setMessages([])
      return
    }

    let cancelled = false

    fetch(`/api/sessions/${sessionId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('session_not_found'))))
      .then((chat: { messages?: StoredMessage[] }) => {
        if (cancelled) return
        setMessages(
          (chat.messages ?? []).map((m) => ({
            id: m.id,
            role: m.role,
            parts: [{ type: 'text' as const, text: m.content }],
          })),
        )
      })
      .catch(() => {
        if (cancelled) return
        // Same three causes as above, reached by a different door.
        setMessages([])
        onSessionChange(null)
      })
      .finally(() => {
        if (!cancelled) setOpening(false)
      })

    return () => {
      cancelled = true
    }
  }, [sessionId, setMessages, onSessionChange])

  /**
   * Refresh the recents once a reply has landed.
   *
   * The title is derived server-side from the first message, so the row is
   * created as `New Session` and renamed a moment later. Asking again after
   * the stream ends is what turns it into the sentence you actually typed.
   */
  const streamed = useRef(false)
  useEffect(() => {
    if (status === 'streaming') streamed.current = true
    else if (streamed.current && status === 'ready') {
      streamed.current = false
      onChatsChanged()
    }
  }, [status, onChatsChanged])

  const submit = async () => {
    const text = input.trim()
    if (!text || status !== 'ready') return
    // A new attempt supersedes whatever the last one said.
    setFailure(null)

    let sid = sessionId ?? null
    if (!sid) {
      const res = await fetch('/api/sessions', { method: 'POST' })
      if (!res.ok) {
        // Standing rule: never fail blankly. This used to log to a console
        // nobody has open, leaving someone pressing a button that did nothing.
        // The typed text stays in the box either way.
        setFailure('Could not start a conversation. Your text is still here — try again.')
        return
      }
      sid = (await res.json()).id as string
      // Claimed before the switch, so the load effect leaves the message that
      // is about to appear alone.
      loadedFor.current = sid
      onSessionChange(sid)
      onChatsChanged() // the row exists now; show it rather than after the reply
    }

    // mode, taggedChatIds and sessionId must all be sent PER CALL: the
    // transport's constructor body is frozen at mount, and sessionId is null
    // then. Per-call body is merged over it at send time.
    sendMessage(
      { text },
      {
        body: {
          sessionId: sid,
          mode,
          taggedChatIds: tagged.map((t) => t.id),
          // Omitted rather than sent as null: the route treats an absent model
          // as "you pick", and `resolveModel` is the one that knows what this
          // daemon actually has.
          ...(model ? { model } : {}),
        },
      },
    )
    setInput('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', minWidth: 0, background: 'var(--bg)' }}>
      {/* The chat's own title, which is what a rename changes and where the
          Headline pill will sit later. */}
      <header className="chat-head">
        <span className="t">{activeChat?.title ?? 'New chat'}</span>
        <span className="meta tnum">
          {mode}
          {activeChat ? ` · ${activeChat.nodeCount} concept${activeChat.nodeCount === 1 ? '' : 's'}` : ''}
        </span>
        {/* Re-read whenever a turn finishes, so the ring moves on the reply
            the visitor was already waiting for rather than on a poll. */}
        <UsageGauge refreshKey={messages.length} />
      </header>

      {/* The turns are centred in a column rather than spread across the pane.
          Full width, a right-aligned question and a left-aligned answer end up
          at opposite edges of a 1200px gap and stop reading as one
          conversation. */}
      <div className="thread">
        <div className="thread-col">
        {opening && (
          <p style={{ margin: 'auto', fontSize: 12.5, color: 'var(--ink3)' }}>Opening this chat…</p>
        )}

        {!opening && messages.length === 0 && (
          <div style={{ margin: 'auto', maxWidth: 420, textAlign: 'center' }}>
            <p style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--ink2)', margin: 0 }}>
              {chats.length === 0
                ? 'Nothing here yet. Say something, and this becomes your first conversation.'
                : 'A new conversation. Say something, or bring a past one in with @.'}
            </p>
          </div>
        )}

        {!opening &&
          messages.map((m) => (
            <div key={m.id} style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: 640, fontSize: 13.5, lineHeight: 1.65,
              background: m.role === 'user' ? 'var(--white)' : 'transparent',
              border: m.role === 'user' ? '1px solid var(--border)' : 'none',
              borderRadius: 14, padding: m.role === 'user' ? '11px 15px' : 0,
              color: m.role === 'user' ? 'var(--ink)' : 'var(--ink2)',
            }}>
              {m.parts.filter((p) => p.type === 'text').map((p) => p.text).join('')}
            </div>
          ))}

        {status === 'streaming' && (
          <div style={{ alignSelf: 'flex-start', display: 'flex', gap: 4 }} aria-label="Thinking">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>
        )}
        </div>
      </div>

      <div className="composer">
        <div className="composer-col">
        {/* Above the box, not over the transcript: the thing that failed is
            the send, and the recovery is right here — the text is already
            back in the field. */}
        {failure && (
          <p className="composer-failed" role="status">
            <AlertCircle size={13} aria-hidden="true" />
            <span>{failure}</span>
          </p>
        )}

        {showCommands && (
          <CommandPicker
            query={slashQuery ?? ''}
            mode={mode}
            onPick={(next) => {
              setMode(next)
              // The command is not part of the message, so it does not stay in
              // the box once it has been run.
              setInput('')
              setSlashOff(false)
            }}
            onDismiss={() => setSlashOff(true)}
          />
        )}

        {atQuery !== null && !showCommands && (
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
                  aria-label={`Stop using ${t.title}`}
                  style={{ marginLeft: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>×</button>
              </span>
            ))}
          </div>
        )}

        <label className="sr-only" htmlFor="chat-composer">Your message</label>
        <textarea
          id="chat-composer"
          className="composer-box"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() } }}
          enterKeyHint="send"
          placeholder="Ask anything — @ to bring in a past chat"
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <button onClick={() => setMode(mode === 'focus' ? 'explore' : 'focus')}
            aria-label={`Mode: ${mode}. Switch to ${mode === 'focus' ? 'explore' : 'focus'}`}
            style={{ fontSize: 11, padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 7,
              background: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
            /mode {mode}
          </button>
          <ModelPicker value={model} onChange={chooseModel} />
          <span className="composer-note">
            Nothing is saved to your graph unless you use @ or a command.
          </span>
          <button className="btn-send" onClick={submit} disabled={status !== 'ready' || !input.trim()}>
            Send
          </button>
        </div>
        </div>
      </div>
    </div>
  )
}
