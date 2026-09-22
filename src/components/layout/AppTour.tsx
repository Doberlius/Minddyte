'use client'

import { CardTour, Point, type Slide } from '@/components/ui/CardTour'
import { ShapeComparison } from '@/components/ui/GraphShapes'

/**
 * How to use the application, on first run.
 *
 * The demo's deck and this one share a shell and the one diagram that makes
 * the product's argument. Everything else differs, and must: the demo has no
 * model and says so, this one talks to a daemon on your own machine and has
 * to say what happens when that daemon is not running.
 *
 * Nothing here claims a feature that is not built. Forgetting is in the demo
 * only, and there is no web search anywhere, so neither appears.
 */

const SLIDES: Slide[] = [
  {
    title: 'Your conversations remember each other',
    body: (
      <>
        <p>
          Minddyte is a chat app that runs on your machine. The difference is what happens
          after you press send: it takes the concepts out of what you wrote and files that
          conversation beside every other one that mentioned the same thing.
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
          Two conversations are related here when they hold the same concept. Nobody drew that
          line and no model judged it — it is a fact about the words you used.
        </p>
        <ul className="tour-points">
          <Point>
            Every line traces back to a sentence you wrote. Point at one and you can name the
            sentence.
          </Point>
          <Point>The same messages always build the same map. It never drifts.</Point>
          <Point>
            No model touches the graph, so it cannot invent a connection — and the map costs
            nothing to keep.
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
          Type the way you would anywhere else. Answers come from a model on your own machine:
          Minddyte talks to <strong>Ollama</strong> on localhost and holds no API key of its
          own. If the daemon is not running, the composer says so rather than failing quietly.
        </p>
        <p>
          The concepts it takes from your message are the ones with a shape it can trust — a
          name like <code>PostgreSQL</code> goes straight in, while a plain lowercase word like{' '}
          <code>data</code> is a real concept only <strong>29%</strong> of the time and is held
          back rather than assumed.
        </p>
      </>
    ),
  },
  {
    title: 'You decide what it is allowed to see',
    body: (
      <>
        <p>Three controls sit under the message box, and all three apply to the next message.</p>
        <ul className="tour-points">
          <Point>
            <code>@</code> brings another conversation in by hand and loads its memory.
          </Point>
          <Point>
            <code>/mode explore</code> also reaches conversations that share a concept with this
            one, and lets the model use what it already knows.{' '}
            <code>/mode focus</code> reaches nothing you did not bring in, and answers from that
            memory alone — narrow on purpose, and narrow in practice.
          </Point>
          <Point>
            The <strong>model</strong> pill picks which cloud model answers, or leaves it to
            whatever your daemon offers.
          </Point>
        </ul>
        <p style={{ marginTop: 13 }}>
          Type <code>/</code> or <code>@</code> in the box and the list opens; the pills do the
          same thing by hand.
        </p>
      </>
    ),
  },
  {
    title: 'Read the map',
    body: (
      <>
        <p>
          On <strong>Brain</strong>, rectangles are conversations and pills are concepts.
        </p>
        <p>
          A filled violet pill is a concept more than one conversation mentions, and the number
          on it says how many. Those are the joins — the rest is context. Drag anything you
          like; nothing there breaks.
        </p>
      </>
    ),
  },
  {
    title: 'The memory is your own sentences',
    body: (
      <>
        <p>
          <strong>Archive</strong> shows what the assistant actually receives for each
          conversation: sentences taken from your messages word for word, newest first, never
          rewritten or summarised, capped at 500 characters.
        </p>
        <p>
          It is the honest view of the memory, including when there is very little of it. A
          long reply fills that cap quickly, which is worth knowing before you rely on{' '}
          <code>/mode focus</code>.
        </p>
      </>
    ),
  },
  {
    title: 'Keep the list yours',
    body: (
      <>
        <p>
          Right-click any conversation in the sidebar — or press the <strong>···</strong> on its
          row — to rename it or delete it. Deleting takes its messages and its memory with it
          and cannot be undone, so it asks once more before it does.
        </p>
        <p style={{ marginTop: 13 }}>
          That is everything. This guide is in the sidebar under{' '}
          <strong>?</strong> whenever you want it again.
        </p>
      </>
    ),
  },
]

export function AppTour({ onClose }: { onClose: () => void }) {
  return <CardTour slides={SLIDES} finalLabel="Start talking" onClose={onClose} />
}
