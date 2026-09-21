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

function list(items: string[]): string {
  if (items.length === 1) return items[0]
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

export function writtenReply({ auto, connected, suggested }: ReplyInput): string {
  if (auto.length === 0) {
    const hint =
      suggested.length > 0
        ? ` I saw ${list(suggested)}, but a single lowercase word is only ever suggested, never indexed on its own.`
        : ''
    return `No concept was firm enough to index there.${hint} Naming a tool or a library usually gives the extractor something to hold.`
  }

  if (connected.length > 0) {
    return `Indexed ${list(auto)}. ${list(connected)} already appeared in other conversations here, so those are now linked — nobody filed them, the overlap simply follows from what was said.`
  }

  return `Indexed ${list(auto)}. Nothing else in this graph mentions them yet, so they sit on their own for now. Say one of them again in another conversation and the link appears by itself.`
}
