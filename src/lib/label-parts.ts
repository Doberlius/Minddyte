import { canonicalKey } from './text'

/**
 * Ticket 10, F9–F10: the words of a concept's name that the forget modal
 * offers as "forget these too". A person who forgets "Steve Jobs" also
 * means the sentences that say only "Jobs", but a machine cannot know
 * which parts matter ("Kafka partitions": yes to Kafka, probably not to
 * "partitions"), so each is offered, unticked, and the person decides.
 *
 * Words are split on anything that is not a letter, digit or `_`, the same
 * breaks src/lib/mentions.ts uses. Little words would only ever be noise.
 */
const LITTLE = new Set([
  'a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'is', 'it', 'its', 'my', 'of', 'on', 'or',
  'our', 'the', 'their', 'this', 'that', 'to', 'we', 'with', 'your',
])

/** Every word of a text, split on the same breaks as src/lib/mentions.ts. */
function wordsOf(text: string): string[] {
  return text.split(/[^\p{L}\p{N}_]+/u).filter(Boolean)
}

export function labelParts(label: string): string[] {
  const words = wordsOf(label)
  if (words.length < 2) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of words) {
    const k = w.toLowerCase()
    if (k.length < 2 || LITTLE.has(k) || seen.has(k)) continue
    seen.add(k)
    out.push(w)
  }
  return out
}

export type PartKind = 'offer' | 'own-concept' | 'part-of'

/**
 * What the forget modal may do with each offered word (ticket 10, F14/F15).
 *   - 'offer': a checkbox. Ticking it forgets the word in this chat.
 *   - 'own-concept' (F14): the word IS another concept of this chat
 *     ("Kafka" while forgetting "Kafka partitions"). No box: forgetting it
 *     belongs in its own dialog.
 *   - 'part-of' (F15): the word is inside another concept's name in this
 *     chat ("Steve" while "Steve Wozniak" is linked). No box: ticking it
 *     would hide every "Steve Wozniak" sentence too. `partOf` names those
 *     concepts.
 * The same promise both ways: a ticked word can never silence another
 * concept. If both apply, 'own-concept' wins.
 *
 * `linked` is every concept linked to the chat. The concept being forgotten
 * (`ownKey`) is left out of it, so its own words never refuse themselves:
 * "Kafka 数据" has the key "kafka", the same as its word "Kafka".
 *
 * The preview (what the modal shows) and forgetConcept (what the server
 * accepts) both call this, so they can never disagree.
 */
export function classifyParts(
  label: string,
  ownKey: string,
  linked: { key: string; label: string }[],
): { word: string; kind: PartKind; partOf: string[] }[] {
  const others = linked.filter((c) => c.key !== ownKey)
  // An empty key (a word with no a–z or 0–9, such as "数据") says nothing
  // about which concept it is, so it never counts as a match.
  const otherKeys = new Set(others.map((c) => c.key).filter(Boolean))
  const otherWords = others.map((c) => ({ label: c.label, words: new Set(wordsOf(c.label).map((w) => w.toLowerCase())) }))

  return labelParts(label).map((word) => {
    const key = canonicalKey(word)
    if (key && otherKeys.has(key)) return { word, kind: 'own-concept' as const, partOf: [] }
    const lower = word.toLowerCase()
    const partOf = [...new Set(otherWords.filter((c) => c.words.has(lower)).map((c) => c.label))].sort(byName)
    if (partOf.length > 0) return { word, kind: 'part-of' as const, partOf }
    return { word, kind: 'offer' as const, partOf: [] }
  })
}

/** A to Z ignoring case, then by exact spelling, so the order never depends on the database's row order. */
function byName(a: string, b: string): number {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0
}
