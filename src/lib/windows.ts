import { PROVISIONAL } from './provisional'

/** One passage of a reached chat, scored against the question. */
export type ScoredPointer = {
  messageId: string
  /** epoch ms — orders messages within the chat */
  messageCreatedAt: number
  ordinal: number
  /** the verbatim passage, read from messages.content by offset */
  text: string
  score: number
}

/** One merged passage of a reached chat, with the date of the message it belongs to. Ticket 03, Q5. */
export type Excerpt = { text: string; at: number }

/**
 * Which passages of one chat go into the prompt. Ticket 05, Q10.
 *
 * 1. Put every passage in conversation order (message time, then message id
 *    for determinism, then ordinal).
 * 2. Take the `picks` best by score. Ties go to the EARLIER passage — never to
 *    the shorter one: preferring short is ticket 11's measured failure.
 * 3. Add one neighbour either side, within the same message only, so no
 *    excerpt opens on a dangling "it" or "therefore".
 * 4. Merge touching passages into one excerpt; return excerpts in order.
 */
export function selectWindows(rows: ScoredPointer[], picks: number = PROVISIONAL.windowsPerChat): Excerpt[] {
  const ordered = [...rows].sort(
    (a, b) =>
      // scoredPointers now derives messageCreatedAt from extract(epoch from
      // created_at) * 1000 in SQL, which keeps sub-millisecond precision —
      // finer-grained than the old Date#getTime() (truncated to whole ms) —
      // but it is still only a tiebreak ahead of messageId/ordinal below.
      a.messageCreatedAt - b.messageCreatedAt ||
      (a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0) ||
      a.ordinal - b.ordinal,
  )
  const top = ordered
    .map((_, i) => i)
    .sort((a, b) => ordered[b].score - ordered[a].score || a - b)
    .slice(0, picks)

  const keep = new Set<number>()
  for (const i of top) {
    for (const j of [i - 1, i, i + 1]) {
      if (j >= 0 && j < ordered.length && ordered[j].messageId === ordered[i].messageId) keep.add(j)
    }
  }

  const excerpts: Excerpt[] = []
  let run: ScoredPointer[] = []
  let prev = -2
  for (const i of [...keep].sort((a, b) => a - b)) {
    // `rows` is now sparse — only picks and their +-1 neighbours, per
    // scoredPointers' SQL — so two kept windows can be next to each other in
    // this ARRAY without being next to each other by ORDINAL (e.g. picks at
    // ordinal 2 and 6 leave a gap at ordinal 4 that is simply absent from
    // `ordered`). "touching" must be decided by ordinal, never by array
    // position, or non-adjacent passages splice into one excerpt with the
    // gap silently dropped.
    const touching = prev >= 0 && ordered[i].messageId === ordered[prev].messageId && ordered[i].ordinal === ordered[prev].ordinal + 1
    if (!touching && run.length > 0) {
      excerpts.push({ text: run.map((r) => r.text).join('\n'), at: run[0].messageCreatedAt })
      run = []
    }
    run.push(ordered[i])
    prev = i
  }
  if (run.length > 0) excerpts.push({ text: run.map((r) => r.text).join('\n'), at: run[0].messageCreatedAt })
  return excerpts
}
