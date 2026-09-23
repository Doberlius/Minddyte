'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * How much of this minute's allowance is left, as a ring that empties.
 *
 * A ring rather than a number because the number is not what anyone wants
 * most of the time. Full means "carry on" and should cost no attention at
 * all; the gap only opens once there is something to know, and an opening
 * gap is the one thing peripheral vision is good at. A bare "7/10" in the
 * header demands a reading every time it changes and says nothing the moment
 * it is read.
 *
 * It asks the server rather than counting locally. A client-side tally
 * drifts the moment a request fails, a tab is duplicated, or the container
 * restarts, and a meter that disagrees with the thing it measures is worse
 * than no meter.
 */

type Usage = { remaining: number; limit: number; resetInSeconds: number }

/** Below this the ring turns; see the comment on the colour in global.css. */
const LOW = 3

const R = 7
const CIRCUMFERENCE = 2 * Math.PI * R

export function UsageGauge({ refreshKey }: { refreshKey: number }) {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [open, setOpen] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const card = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/usage')
      if (!res.ok) return
      const next = (await res.json()) as Usage
      setUsage(next)
      setSeconds(next.resetInSeconds)
    } catch {
      // A meter that cannot reach the server tells you nothing, which is
      // exactly what it should then show. Keeping the last value would be a
      // confident lie about a number that has certainly moved.
      setUsage(null)
    }
  }, [])

  // `refreshKey` changes when a message finishes, so the ring updates from
  // the reply the visitor was already waiting for rather than on a timer.
  useEffect(() => {
    void load()
  }, [load, refreshKey])

  // The countdown only runs while it is being read, or while it is the whole
  // answer. A permanent interval would re-render the header once a second
  // for the entire session to animate a number nobody is looking at.
  const spent = usage !== null && usage.remaining === 0
  useEffect(() => {
    if (!open && !spent) return
    if (seconds <= 0) return

    const tick = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          // Reached zero: the server is the authority on what opened up, so
          // ask rather than assume the slot is ours.
          void load()
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [open, spent, seconds, load])

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (card.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    // Capture, because a click that lands on something which unmounts itself
    // never bubbles back here and the card would stay open behind it.
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (usage === null) return null

  const fraction = usage.limit > 0 ? usage.remaining / usage.limit : 0
  const low = usage.remaining <= LOW
  const label = spent
    ? `No messages left this minute. The next one opens in ${seconds} seconds.`
    : `${usage.remaining} of ${usage.limit} messages left this minute.`

  return (
    <div className="gauge" ref={card}>
      <button
        type="button"
        className="gauge-btn"
        data-low={low || undefined}
        data-spent={spent || undefined}
        // Hover is the asked-for gesture, but it is not available on a touch
        // screen and not reachable from a keyboard, so the same card opens on
        // focus and on press. The CSS handles hover; these handle the rest.
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          if (!card.current?.contains(e.relatedTarget as Node)) setOpen(false)
        }}
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <circle className="gauge-track" cx="9" cy="9" r={R} />
          <circle
            className="gauge-arc"
            cx="9"
            cy="9"
            r={R}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
          />
        </svg>
      </button>

      {/* Not aria-hidden: the button's own label already carries the numbers,
          so a screen reader gets them without the card ever opening. */}
      <div className="gauge-pop" data-open={open || undefined} role="presentation">
        <p className="gauge-count">
          <strong>{usage.remaining}</strong> of {usage.limit} left
        </p>
        <p className="gauge-sub">
          {spent
            ? `Next message in ${seconds}s`
            : seconds > 0
              ? `One more frees up in ${seconds}s`
              : 'Ten messages a minute'}
        </p>
        {/* Said here rather than only at the moment of refusal: someone who
            understands the cap before they hit it reads a refusal as a budget,
            and someone who meets it cold reads it as the app being broken. */}
        <p className="gauge-why">A shared demo on a fixed budget — the limit resets as you go.</p>
      </div>
    </div>
  )
}
