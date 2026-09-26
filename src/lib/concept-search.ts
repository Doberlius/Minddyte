/**
 * Narrowing a long list of concept names as the person types (the `/forget`
 * picker's search field). A chat built from a pasted essay can hold 50+
 * concepts; scrolling that for one name is the problem this solves.
 *
 * Matching ignores case and accents ("cafe" finds "Café"), and ranks the
 * way people scan: names that START with what was typed, then names with a
 * WORD that starts with it, then names that merely contain it. Ties keep the
 * list's own order, which the caller has already made alphabetical.
 */

/** Lowercase, accents removed. One code unit in, one out, so indexes line up. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

export type ConceptMatch<T> = {
  item: T
  /** Where the typed text sits in the ORIGINAL name, for highlighting; null when nothing is typed. */
  at: { start: number; end: number } | null
}

/**
 * The items whose `name(item)` contains `query`, best first. An empty or
 * whitespace-only query returns every item, unhighlighted, in order.
 */
export function searchConcepts<T>(items: T[], query: string, name: (item: T) => string): ConceptMatch<T>[] {
  const q = fold(query.trim())
  if (!q) return items.map((item) => ({ item, at: null }))

  const scored: { match: ConceptMatch<T>; rank: number; order: number }[] = []
  items.forEach((item, order) => {
    const original = name(item)
    // Folding can change length (a precomposed "é" becomes "e" + a mark that
    // is then removed), so map positions through a per-character fold.
    const chars = [...original]
    const folded = chars.map((c) => fold(c))
    const flat = folded.join('')
    const hit = flat.indexOf(q)
    if (hit < 0) return

    const wordStart = hit === 0 || /[^\p{L}\p{N}]/u.test(flat[hit - 1])
    const rank = hit === 0 ? 0 : wordStart ? 1 : 2

    // Back from positions in `flat` to positions in `original`.
    let flatPos = 0
    let start = -1
    let end = original.length
    let origPos = 0
    for (let i = 0; i < chars.length; i++) {
      if (start < 0 && flatPos + folded[i].length > hit) start = origPos
      flatPos += folded[i].length
      origPos += chars[i].length
      if (flatPos >= hit + q.length) {
        end = origPos
        break
      }
    }
    scored.push({ match: { item, at: { start: Math.max(0, start), end } }, rank, order })
  })

  return scored.sort((a, b) => a.rank - b.rank || a.order - b.order).map((s) => s.match)
}
