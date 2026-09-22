'use client'

import { ArrowRight } from 'lucide-react'
import { CardTour, Point, type Slide } from '@/components/ui/CardTour'
import { ShapeComparison } from '@/components/ui/GraphShapes'

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
          <ShapeComparison />
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
  return <CardTour slides={slides(onStart)} finalLabel="Start exploring" onClose={onClose} />
}
