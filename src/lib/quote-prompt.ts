import type { UIMessage } from 'ai'
import { stripVisualize } from '@/lib/scene/intent'

/**
 * What the model is told about a user message's quote (Q19). The text comes
 * from the database, never from the browser: `quotesForModel` builds these.
 * `deleted` is a quote whose target is gone (Q18).
 */
export type QuoteForModel = { kind: 'part' | 'whole'; role: 'user' | 'assistant'; text: string } | { kind: 'deleted' }

/** A highlighted part is sent in full up to this many code points; a whole message only its start. */
const PART_CAP = 2000
const WHOLE_CAP = 200

/** Cut at `cap` code points, never splitting a surrogate pair, with `…` when cut. */
function cap(text: string, max: number): string {
  const points = Array.from(text)
  return points.length > max ? points.slice(0, max).join('') + '…' : text
}

/**
 * Q19: the block put in front of a user's text for the model. Only the
 * model's view: the stored `content`, extraction, pointers and retrieval all
 * keep the typed text alone (Q16, Q17).
 */
export function withQuote(text: string, quote: QuoteForModel | null): string {
  if (!quote) return text
  if (quote.kind === 'deleted') return `Replying to a deleted message.\n\n${text}`
  const heading = quote.role === 'assistant' ? 'Replying to your earlier reply:' : 'Replying to my earlier message:'
  const quoted = cap(quote.text, quote.kind === 'part' ? PART_CAP : WHOLE_CAP)
    .split(/\r\n|\r|\n/)
    .map((line) => `> ${line}`)
    .join('\n')
  return `${heading}\n${quoted}\n\n${text}`
}

/**
 * The model's view of a history: every user message with an entry in
 * `quotes` gets its text replaced by `withQuote`. Its text parts become one,
 * where the first one was; its other parts keep their order. Returns new
 * objects for the messages it changes and never changes what it was given:
 * the route reads its draft from the same messages.
 */
export function withQuotes(messages: UIMessage[], quotes: Map<string, QuoteForModel>): UIMessage[] {
  return messages.map((m) => {
    const quote = m.role === 'user' ? quotes.get(m.id) : undefined
    if (!quote) return m
    const text = m.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('')
    const merged = { type: 'text' as const, text: withQuote(text, quote) }
    const first = m.parts.findIndex((p) => p.type === 'text')
    const parts = first === -1
      ? [merged, ...m.parts]
      : [...m.parts.slice(0, first), merged, ...m.parts.slice(first).filter((p) => p.type !== 'text')]
    return { ...m, parts }
  })
}

/**
 * The chat route's three texts for a turn, from the browser's `messages`
 * (the last one is the message being sent) and the quotes read for them
 * (`quotesForModel`). The route takes all three from here and nowhere else:
 * - `draft`: what was typed in the last message, stored as its `content` (Q17);
 * - `memoryDraft`: `draft` without a leading `/visualize`, the only text
 *   retrieval, extraction and pointers read (spec §3). A quote never reaches
 *   either (Q16);
 * - `history`: what the model reads, every quoted user message with its quote
 *   in front (`withQuotes`, Q19).
 */
export function turnText(
  messages: UIMessage[],
  quotes: Map<string, QuoteForModel>,
): { draft: string; memoryDraft: string; history: UIMessage[] } {
  const last = messages[messages.length - 1]
  const draft = last?.parts?.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('') ?? ''
  return { draft, memoryDraft: stripVisualize(draft), history: withQuotes(messages, quotes) }
}
