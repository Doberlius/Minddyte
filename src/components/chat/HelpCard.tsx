'use client'

import { X } from 'lucide-react'
import { HELP_ENTRIES } from './commands'

/**
 * The full list of working commands, opened by `/help` (ticket 08, Q7, Q9).
 *
 * Reads the same list the / menu filters (`./commands`), so the two can
 * never say different things about what a command does.
 */
export function HelpCard({ onClose }: { onClose: () => void }) {
  return (
    <div className="help-card" role="region" aria-label="Commands">
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
