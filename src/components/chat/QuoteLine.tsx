'use client'

import { X } from 'lucide-react'

/**
 * One quote line (reply-to ticket 03). The same line sits in three places:
 * above the composer and in the edit box, where ✕ removes it; and above a sent
 * message, where clicking it scrolls to the message it quotes.
 *
 * `preview` is the quoted text's first line (`quotePreview`), or null when the
 * quoted message has been deleted (Q18). A deleted quote is never clickable:
 * there is nothing left to scroll to.
 */
export function QuoteLine({
  kind,
  preview,
  onOpen,
  onRemove,
}: {
  /** 'compose': "↩ Replying to: …", in the composer or the edit box. 'sent': "↩ …", above a message. */
  kind: 'compose' | 'sent'
  preview: string | null
  onOpen?: () => void
  onRemove?: () => void
}) {
  const label = preview === null ? '↩ replying to a deleted message' : kind === 'compose' ? `↩ Replying to: ${preview}` : `↩ ${preview}`
  return (
    <div className={`quote-line${preview === null ? ' is-gone' : ''}`}>
      {kind === 'sent' && preview !== null && onOpen ? (
        <button className="quote-line-text" onClick={onOpen} title="Show the quoted message">{label}</button>
      ) : (
        <span className="quote-line-text">{label}</span>
      )}
      {onRemove && (
        <button className="quote-line-x" onClick={onRemove} aria-label="Stop replying" title="Stop replying">
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
