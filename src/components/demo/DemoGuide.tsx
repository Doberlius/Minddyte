'use client'

import { ArrowRight, RotateCcw } from 'lucide-react'
import type { Tab } from '@/app/demo/page'

/**
 * The guide bar.
 *
 * A visitor arrives from a link knowing nothing, and the three tabs are named
 * after the product's own concepts — Chat, Neural Brain, Memory Archives —
 * which say what a thing is called rather than what it does for you. Watching
 * the demo cold, the failure was never that a panel looked wrong; it was that
 * there was no answer to "what am I supposed to do, and did it work?".
 *
 * So this bar carries exactly three things: where you are, one sentence of
 * what you are looking at, and the single next action. It is deliberately NOT
 * a second row of navigation — the tabs above already navigate, and two sets
 * of links to the same three places is the confusion it was built to remove.
 * The dots report progress and nothing else.
 *
 * It also guarantees there is no dead end. Every state below ends in a button,
 * including the state where the extractor found nothing to index, which is the
 * one place the demo used to leave a visitor with no move to make.
 */

const STEPS: { tab: Tab; label: string }[] = [
  { tab: 'chat', label: 'Say something' },
  { tab: 'brain', label: 'See it connect' },
  { tab: 'archive', label: 'Read the memory' },
]

function Dots({ current, firstDone }: { current: number; firstDone: boolean }) {
  return (
    <>
      <span className="demo-dots" aria-hidden="true">
        {STEPS.map((step, i) => (
          <i
            key={step.tab}
            className={i === current ? 'is-now' : i < current || (i === 0 && firstDone) ? 'is-done' : ''}
          />
        ))}
      </span>
      {/* The dots are decoration to a screen reader; the position is not. */}
      <span className="sr-only">
        Step {current + 1} of {STEPS.length}: {STEPS[current].label}
      </span>
    </>
  )
}

export function DemoGuide({
  tab,
  hasSent,
  onGoto,
  onReset,
}: {
  tab: Tab
  /** Whether the visitor has contributed a message of their own yet. */
  hasSent: boolean
  onGoto: (tab: Tab) => void
  onReset: () => void
}) {
  const current = STEPS.findIndex((s) => s.tab === tab)

  // One sentence and one button per state. Written as data rather than nested
  // ternaries in the markup, so every state the bar can be in is readable at
  // a glance and none of them can be left without an action.
  const copy: Record<string, { text: React.ReactNode; cta: React.ReactNode }> = {
    'chat:new': {
      text: (
        <>
          <strong>Start here.</strong> Name a tool you use, and watch your sentence join a graph
          five other conversations already share.
        </>
      ),
      cta: (
        <button className="demo-guide-cta is-quiet" onClick={() => onGoto('brain')}>
          Look at the graph first
          <ArrowRight size={13} />
        </button>
      ),
    },
    'chat:sent': {
      text: (
        // The chips under the message explain themselves in place. Saying it
        // here as well left a visitor reading the same fact three times before
        // they reached the graph.
        <>
          <strong>That went into the graph.</strong> Your conversation is connected to the ones
          that were already here.
        </>
      ),
      cta: (
        <button className="demo-guide-cta" onClick={() => onGoto('brain')}>
          See where it landed
          <ArrowRight size={13} />
        </button>
      ),
    },
    'brain:new': {
      text: (
        <>
          <strong>Every conversation, and every concept in them.</strong> Nobody tagged or filed
          any of this. Drag a node to pull it around, scroll to zoom.
        </>
      ),
      cta: (
        <button className="demo-guide-cta" onClick={() => onGoto('chat')}>
          Add your own conversation
          <ArrowRight size={13} />
        </button>
      ),
    },
    'brain:sent': {
      text: (
        <>
          {/* Count-agnostic: the visitor can start as many conversations as
              they like now, so this cannot say "the violet card". */}
          <strong>The violet cards are yours.</strong> Every line running out of one reaches a
          concept it shares with another conversation.
        </>
      ),
      cta: (
        <button className="demo-guide-cta" onClick={() => onGoto('archive')}>
          Read the memory
          <ArrowRight size={13} />
        </button>
      ),
    },
    'archive:new': {
      text: (
        <>
          <strong>This is what the assistant is handed</strong> when one conversation is tagged
          into another — the original sentences, word for word, never a summary.
        </>
      ),
      cta: (
        <button className="demo-guide-cta" onClick={() => onGoto('chat')}>
          Add your own conversation
          <ArrowRight size={13} />
        </button>
      ),
    },
    'archive:sent': {
      text: (
        <>
          <strong>Your conversation has a memory now too.</strong> Those are your own words,
          kept as you wrote them and capped rather than paraphrased.
        </>
      ),
      cta: (
        <button className="demo-guide-cta is-quiet" onClick={onReset}>
          <RotateCcw size={12} />
          Start over
        </button>
      ),
    },
  }

  const state = copy[`${tab}:${hasSent ? 'sent' : 'new'}`]

  return (
    <div className="demo-guide">
      <Dots current={current} firstDone={hasSent} />
      {/* Announced when the step changes, so the bar is not a visual-only guide. */}
      <p aria-live="polite">{state.text}</p>
      {state.cta}
    </div>
  )
}
