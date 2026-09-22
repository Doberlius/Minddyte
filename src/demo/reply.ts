/**
 * The demo's written replies.
 *
 * There is no model here and the page says so. The honest thing for a reply to
 * do, then, is not to imitate understanding but to report what the graph
 * actually did with the message — which is the only part of this demo that is
 * real, and the part worth showing.
 *
 * These replies reach the Compaction like any assistant turn, so they are kept
 * to one or two sentences. A paragraph of filler would crowd the visitor's own
 * words out of a 500-character memory and make the memory panel look broken.
 */

export type ReplyInput = {
  /** Concepts that became Nodes. */
  auto: string[]
  /** Concepts that matched a Node the graph already held. */
  connected: string[]
  /** Concepts the shape gate would only suggest, never auto-create. */
  suggested: string[]
}

/**
 * Whether the visitor was asking for an answer rather than stating something.
 *
 * Worth detecting because of what the demo is: there is no model here, so a
 * question gets a report about the graph instead of a reply, and from the
 * other side of the screen that reads as being ignored. "What is SDG" carries
 * no question mark, so punctuation alone does not catch it — the opening word
 * does most of the work.
 *
 * Deliberately generous. A false positive adds one honest line of explanation;
 * a false negative leaves someone waiting for an answer that is never coming.
 */
const ASKING =
  /\?|^\s*(what|why|how|who|whom|whose|when|where|which|is|are|was|were|does|do|did|can|could|should|would|will|tell|explain|describe|define|summari[sz]e|research|give|list|show)\b/i

export function looksLikeAQuestion(text: string): boolean {
  return ASKING.test(text.trim())
}

function list(items: string[]): string {
  if (items.length === 1) return items[0]
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

// `suggested` stays on ReplyInput — the held-back words are still reported,
// by the card under the message rather than by the reply itself.
export function writtenReply({ auto, connected }: ReplyInput): string {
  if (auto.length === 0) {
    // One short sentence, deliberately. The card underneath already names what
    // was held back and what to try instead, and the longer version of this
    // said all of it again: three messages of junk produced three paragraphs
    // of the demo explaining the same rule to itself.
    return 'Nothing firm enough to index there.'
  }

  if (connected.length > 0) {
    // `connected` is a filter of `auto`, so equal lengths mean the same set —
    // and naming that set twice in one breath ("Indexed PostgreSQL and
    // Kubernetes. PostgreSQL and Kubernetes already appeared…") reads like a
    // stutter rather than a report.
    if (connected.length === auto.length) {
      return `Indexed ${list(auto)} — already held by other conversations here, so those are linked now. Nobody filed them; the overlap simply follows from what was said.`
    }
    return `Indexed ${list(auto)}. ${list(connected)} already appeared in other conversations here, so those are now linked — nobody filed them, the overlap simply follows from what was said.`
  }

  return `Indexed ${list(auto)}. Nothing else in this graph mentions them yet, so they sit on their own for now. Say one of them again in another conversation and the link appears by itself.`
}
