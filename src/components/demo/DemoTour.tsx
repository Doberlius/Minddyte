'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check } from 'lucide-react'

/**
 * The opening tour.
 *
 * Its job is not to teach the product. It is to answer the three questions a
 * visitor arrives with — what is this, why is it built this way, and what do I
 * press — and then get out of the way. One idea per card, seven cards, and a
 * way out of every one of them.
 *
 * The second card is the one that earns the overlay. Everything else here can
 * be discovered by clicking around; the reason this graph links conversations
 * to concepts instead of ideas to ideas cannot, and it is the half an
 * interviewer actually asks about.
 */

/** Both diagrams draw on the same grid so the two panels read as comparable. */
function Dot({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <>
      <circle cx={x} cy={y} r="14" fill="var(--white)" stroke="var(--pill-border)" />
      <text x={x} y={y + 3.5} textAnchor="middle" fontSize="9" fill="var(--ink3)">
        {label}
      </text>
    </>
  )
}

function IdeaToIdea() {
  return (
    <svg viewBox="0 0 200 104" role="img" aria-label="Four ideas joined to each other by inferred links">
      <g stroke="var(--line-quiet)" strokeWidth="1.5" strokeDasharray="3 3">
        <line x1="44" y1="30" x2="110" y2="26" />
        <line x1="110" y1="26" x2="156" y2="62" />
        <line x1="44" y1="30" x2="72" y2="78" />
        <line x1="72" y1="78" x2="156" y2="62" />
        <line x1="110" y1="26" x2="72" y2="78" />
      </g>
      <Dot x={44} y={30} label="idea" />
      <Dot x={110} y={26} label="idea" />
      <Dot x={72} y={78} label="idea" />
      <Dot x={156} y={62} label="idea" />
    </svg>
  )
}

function ChatToConcept() {
  return (
    <svg
      viewBox="0 0 200 104"
      role="img"
      aria-label="Two conversations both joined to one shared concept between them"
    >
      {/* Geometry is spaced so nothing overlaps: the chats end at x 64 and 136,
          the concept runs 66 to 134 between them, and the two rows are 12
          apart vertically. An overlapping diagram argues against the claim it
          is drawn to make. */}
      <g stroke="var(--line-strong)" strokeWidth="1.8">
        <line x1="36" y1="40" x2="100" y2="54" />
        <line x1="164" y1="40" x2="100" y2="54" />
      </g>
      <g fill="var(--white)" stroke="var(--pill-border)">
        <rect x="8" y="14" width="56" height="26" rx="6" />
        <rect x="136" y="14" width="56" height="26" rx="6" />
      </g>
      <g textAnchor="middle" fontSize="9" fill="var(--ink3)">
        <text x="36" y="30.5">chat</text>
        <text x="164" y="30.5">chat</text>
      </g>
      <rect x="66" y="52" width="68" height="24" rx="12" fill="var(--violet)" />
      <text x="100" y="67.5" textAnchor="middle" fontSize="9" fontWeight="600" fill="#fff">
        concept
      </text>
      <text x="100" y="94" textAnchor="middle" fontSize="9" fill="var(--violet)">
        both of them said it
      </text>
    </svg>
  )
}

function Point({ children }: { children: React.ReactNode }) {
  return (
    <li>
      <Check size={15} strokeWidth={2.5} aria-hidden="true" />
      <span>{children}</span>
    </li>
  )
}

type Slide = { title: string; body: React.ReactNode }

const OPENER = 'We run PostgreSQL on Kubernetes in production.'

function slides(onStart: (text: string) => void): Slide[] {
  return [
    {
      title: 'Your conversations remember each other',
      body: (
        <>
          <p>
            Minddyte is a chat app. The difference is what happens after you press send: it
            takes the concepts out of what you wrote and files that conversation beside every
            other one that mentioned the same thing.
          </p>
          <p>
            You never sort anything into folders, and you never tag anything. The structure is
            a by-product of talking.
          </p>
        </>
      ),
    },
    {
      title: 'It maps conversations, not ideas',
      body: (
        <>
          <div className="tour-compare">
            <div className="tour-panel">
              <h3>The usual knowledge graph</h3>
              <IdeaToIdea />
              <p>A model reads your notes and decides which ideas are related.</p>
            </div>
            <div className="tour-panel is-ours">
              <h3>Minddyte</h3>
              <ChatToConcept />
              <p>A conversation links only to concepts actually said in it.</p>
            </div>
          </div>
          <p>
            Two conversations are related here when they hold the same concept. Nobody drew
            that line and no model judged it — it is a fact about the words you used.
          </p>
          <ul className="tour-points">
            <Point>
              Every line traces back to a sentence you wrote. Point at one and you can name the
              sentence.
            </Point>
            <Point>The same messages always build the same map. It never drifts.</Point>
            <Point>
              No model touches the graph, so it cannot invent a connection — and it costs
              nothing to run.
            </Point>
            <Point>
              A concept is an index into your conversations, so the memory stays your original
              sentences instead of a summary of them.
            </Point>
          </ul>
        </>
      ),
    },
    {
      title: 'Say something',
      body: (
        <>
          <p>
            Type the way you would anywhere else. The moment you send, the transcript shows you
            exactly which concepts were taken from your message — and which were held back.
          </p>
          <p>
            Held back is not a failure. A plain lowercase word like <code>data</code> turns out
            to be a real concept only <strong>29%</strong> of the time, so it gets offered
            rather than assumed. A name like <code>PostgreSQL</code> is right essentially
            always, so it goes straight in.
          </p>
        </>
      ),
    },
    {
      title: 'You decide what it is allowed to see',
      body: (
        <>
          <p>
            Memory you cannot control is a liability, so two controls sit under the message box.
          </p>
          <ul className="tour-points">
            <Point>
              <code>@</code> brings another conversation in by hand, for that one message.
            </Point>
            <Point>
              <code>/mode explore</code> also reaches conversations that share a concept with
              yours. <code>/mode focus</code> reaches nothing you did not bring in yourself.
            </Point>
          </ul>
          <p>
            After every message the transcript names the conversations that were used and why
            each one came back. Nothing reaches the assistant without saying so.
          </p>
        </>
      ),
    },
    {
      title: 'Read the map',
      body: (
        <>
          <p>
            On <strong>Neural Brain</strong>, rectangles are conversations and pills are
            concepts.
          </p>
          <p>
            A filled violet pill is a concept more than one conversation mentions, and the
            number on it says how many. Those are the joins — the rest is context. Drag
            anything you like; nothing here breaks.
          </p>
        </>
      ),
    },
    {
      title: 'The memory is yours to take back',
      body: (
        <>
          <p>
            <strong>Memory Archives</strong> shows what the assistant would actually receive for
            each conversation: your own sentences, word for word, never rewritten or summarised,
            capped at 500 characters.
          </p>
          <p>
            Press the <strong>×</strong> on any concept there and its sentences leave that
            memory for good — including if you mention it again later. The message stays
            readable in the conversation. The assistant simply never sees it again.
          </p>
        </>
      ),
    },
    {
      title: 'Try this first',
      body: (
        <>
          <p>
            Send this and watch it land in two places at once — the map already holds both of
            those names.
          </p>
          <button className="demo-prompt" onClick={() => onStart(OPENER)}>
            <span>{OPENER}</span>
            <ArrowRight size={13} aria-hidden="true" />
          </button>
          <p style={{ marginTop: 13 }}>
            Or close this and write anything you like. Everything here runs in your browser, and
            nothing is saved anywhere.
          </p>
        </>
      ),
    },
  ]
}

export function DemoTour({
  onClose,
  onStart,
}: {
  onClose: () => void
  /** Close the tour and send this message, so the last card ends in the product. */
  onStart: (text: string) => void
}) {
  const [index, setIndex] = useState(0)
  const card = useRef<HTMLDivElement>(null)
  const deck = slides(onStart)
  const slide = deck[index]
  const last = index === deck.length - 1

  // Focus moves into the dialog so the keys below reach it and a screen reader
  // starts reading here rather than at the top of the page behind it.
  useEffect(() => {
    card.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, deck.length - 1))
      if (event.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deck.length, onClose])

  return (
    <div
      className="tour-scrim"
      // A click on the backdrop closes, the way every overlay a visitor has
      // ever used does. The card stops its own clicks from reaching it.
      onClick={onClose}
    >
      <div
        ref={card}
        className="tour"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <button className="tour-skip" onClick={onClose}>
          Skip
        </button>

        <div className="tour-body">
          <h2 id="tour-title">{slide.title}</h2>
          {slide.body}
        </div>

        <div className="tour-foot">
          <span className="demo-dots" aria-hidden="true">
            {deck.map((s, i) => (
              <i key={s.title} className={i === index ? 'is-now' : i < index ? 'is-done' : ''} />
            ))}
          </span>
          <span className="sr-only" aria-live="polite">
            Card {index + 1} of {deck.length}: {slide.title}
          </span>

          <div className="tour-nav">
            {index > 0 && (
              <button className="tour-back" onClick={() => setIndex(index - 1)}>
                Back
              </button>
            )}
            <button
              className="tour-next"
              onClick={() => (last ? onClose() : setIndex(index + 1))}
            >
              {last ? 'Start exploring' : 'Next'}
              <ArrowRight size={13} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
