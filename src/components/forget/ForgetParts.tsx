'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ForgetPart } from '@/services/forget'

/**
 * The forget dialog's offer of the name's parts (ticket 10 follow-up,
 * F9–F12, F14). Forgetting "Steve Jobs" hides the sentences that say
 * "Steve Jobs", but some sentences say only "Jobs". Those are listed here,
 * one row per word, so the person can choose to forget them too.
 *
 * Nothing here is forgotten unless the person ticks it: every box starts
 * empty. Each row also has a button, "Jobs (4)", that shows and hides the
 * sentences that word would take with it, so the choice is made on what
 * the person can read, not on a guess.
 *
 * Two kinds of word get no box, only a note, and still let the person look
 * at their sentences (ticking either would silence another concept):
 *   - F14: a word that is a concept of its own in this chat ("alsoConcept").
 *     Forgetting it belongs in its own dialog.
 *   - F15: a word inside another concept's name in this chat ("partOf"):
 *     "Steve" while forgetting "Steve Jobs" when "Steve Wozniak" is linked.
 *
 * This component only draws the choices. Which words are ticked lives in
 * ForgetDialog, because the Forget button there is what sends them.
 */
/** Whether a part gets a checkbox: it is neither its own concept (F14) nor part of another's name (F15). */
export function canPick(part: ForgetPart): boolean {
  return !part.alsoConcept && part.partOf.length === 0
}

/** “A”, “A” and “B”, “A”, “B” and “C”. */
function quotedList(labels: string[]): string {
  const quoted = labels.map((label) => `“${label}”`)
  return quoted.length < 2 ? quoted.join('') : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`
}

export function ForgetParts({
  parts,
  picked,
  onPick,
  disabled,
}: {
  parts: ForgetPart[]
  /** The words ticked so far. */
  picked: string[]
  /** Tick or untick one word. */
  onPick: (word: string) => void
  /** True while Forget is running, so the choice cannot change under it. */
  disabled: boolean
}) {
  /** The words whose sentences are showing. Several can be open at once. */
  const [open, setOpen] = useState<string[]>([])
  /** The word opened last, so the effect below can bring its list into view. */
  const [justOpened, setJustOpened] = useState<string | null>(null)
  const lists = useRef(new Map<string, HTMLUListElement>())

  // An opened list can end below the dialog's bottom edge. Scroll the
  // dialog's own scroll area just enough to show it ("nearest" moves as
  // little as it can), so nothing above it jumps.
  useEffect(() => {
    if (justOpened) lists.current.get(justOpened)?.scrollIntoView({ block: 'nearest' })
  }, [justOpened])

  function toggle(word: string) {
    if (open.includes(word)) {
      setOpen(open.filter((w) => w !== word))
      setJustOpened(null)
    } else {
      setOpen([...open, word])
      setJustOpened(word)
    }
  }

  return (
    <div className="forget-parts">
      <p id="forget-parts-head" className="forget-parts-head">
        Some sentences mention only part of the name:
      </p>
      <ul className="forget-part-list" aria-labelledby="forget-parts-head">
        {parts.map((part, i) => {
          const isOpen = open.includes(part.word)
          const listId = `forget-part-${i}`
          return (
            <li key={part.word} className="forget-part">
              <div className="forget-part-row">
                {part.alsoConcept ? (
                  <p className="forget-part-own">
                    “{part.word}” is its own concept in this chat. Forget it separately.
                  </p>
                ) : part.partOf.length > 0 ? (
                  <p className="forget-part-own">
                    “{part.word}” is part of {quotedList(part.partOf)} in this chat.
                  </p>
                ) : (
                  // The label wraps the box, so a click on the words ticks it too.
                  <label className="forget-part-pick">
                    <input
                      type="checkbox"
                      checked={picked.includes(part.word)}
                      onChange={() => onPick(part.word)}
                      disabled={disabled}
                    />
                    <span>Also forget “{part.word}”</span>
                  </label>
                )}
                <button
                  type="button"
                  className="forget-part-show"
                  aria-expanded={isOpen}
                  aria-controls={isOpen ? listId : undefined}
                  onClick={() => toggle(part.word)}
                >
                  {part.word} ({part.total.toLocaleString('en-US')})
                  <ChevronDown size={13} aria-hidden="true" />
                </button>
              </div>

              {/* The same quoted list as the main one, already open. */}
              {isOpen && (
                <ul
                  id={listId}
                  ref={(el) => {
                    if (el) lists.current.set(part.word, el)
                    else lists.current.delete(part.word)
                  }}
                  className="forget-quotes is-open"
                  // It can scroll, so the keyboard must be able to reach it.
                  tabIndex={0}
                  aria-label={`Sentences that say “${part.word}”`}
                >
                  {part.sentences.map((sentence, j) => (
                    <li key={j}>{sentence}</li>
                  ))}
                  {part.total > part.sentences.length && (
                    <li className="forget-unshown">
                      …and {(part.total - part.sentences.length).toLocaleString('en-US')} more not shown.
                    </li>
                  )}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
