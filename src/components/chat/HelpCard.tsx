'use client'

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { HELP_ENTRIES } from './commands'

/**
 * The full list of working commands, opened by `/help` (ticket 08, Q7, Q9).
 *
 * Reads the same list the / menu filters (`./commands`), so the two can
 * never say different things about what a command does.
 */
export function HelpCard({ onClose }: { onClose: () => void }) {
  // It opens at the end of the transcript; in a long chat that is below the
  // fold, and a card you asked for and cannot see reads as nothing happening.
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' })
  }, [])
  return (
    <div ref={ref} className="help-card" role="region" aria-label="Commands">
      <div className="help-card-head">
        <span>Commands</span>
        <button className="help-card-close" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>
      <ul className="help-card-list">
        {HELP_ENTRIES.map((e) => (
          <li key={e.name} className="help-card-row">
            <code>{e.label}</code>
            <p className="help-card-what">{e.what}</p>
            <p className="help-card-example">Example: {e.example}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
