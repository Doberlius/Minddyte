'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check } from 'lucide-react'

/**
 * A deck of cards over the page, for the first thing someone sees.
 *
 * The shell only — the cards are passed in. Two surfaces need this and they
 * need to say DIFFERENT things: the demo has no model and says so, the app
 * has one and needs Ollama running. Writing that twice would let the two
 * drift, which is the mistake the Brain and the Archive already stopped
 * making by sharing one implementation each.
 *
 * What the shell owns: the overlay, the motion, the dots, the keyboard, and
 * the promise that every card has a way out.
 */

export type Slide = { title: string; body: React.ReactNode }

/** A consequence, ticked. Shared because both decks make lists of them. */
export function Point({ children }: { children: React.ReactNode }) {
  return (
    <li>
      <Check size={15} strokeWidth={2.5} aria-hidden="true" />
      <span>{children}</span>
    </li>
  )
}

export function CardTour({
  slides,
  finalLabel = 'Start',
  onClose,
}: {
  slides: Slide[]
  /** What the last card's button says. The deck knows where it is sending you. */
  finalLabel?: string
  onClose: () => void
}) {
  const [index, setIndex] = useState(0)
  const card = useRef<HTMLDivElement>(null)
  const slide = slides[index]
  const last = index === slides.length - 1

  // Focus moves into the dialog so the keys below reach it and a screen reader
  // starts reading here rather than at the top of the page behind it.
  useEffect(() => {
    card.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, slides.length - 1))
      if (event.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slides.length, onClose])

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
            {slides.map((s, i) => (
              <i key={s.title} className={i === index ? 'is-now' : i < index ? 'is-done' : ''} />
            ))}
          </span>
          <span className="sr-only" aria-live="polite">
            Card {index + 1} of {slides.length}: {slide.title}
          </span>

          <div className="tour-nav">
            {index > 0 && (
              <button className="tour-back" onClick={() => setIndex(index - 1)}>
                Back
              </button>
            )}
            <button className="tour-next" onClick={() => (last ? onClose() : setIndex(index + 1))}>
              {last ? finalLabel : 'Next'}
              <ArrowRight size={13} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
