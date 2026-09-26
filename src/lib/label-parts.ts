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

export function labelParts(label: string): string[] {
  const words = label.split(/[^\p{L}\p{N}_]+/u).filter(Boolean)
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
