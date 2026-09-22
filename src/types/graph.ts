/**
 * What the Brain and the Archive need in order to draw themselves.
 *
 * Deliberately a VIEW model, not either source's storage model. The demo holds
 * whole transcripts in memory; the app holds rows in PGlite and would rather
 * not ship every message of every conversation to the browser to render a
 * canvas that only counts them. Both map into this, and the two views then
 * have exactly one shape to understand.
 *
 * It is also what keeps the demo honest: the panels a visitor tries are the
 * app's own panels, running the app's own components, because there is only
 * one implementation of each.
 */

export type GraphNode = {
  /** Identity: the label lowercased with non-alphanumerics stripped. */
  key: string
  /** The first label that produced this key. Later spellings never overwrite it. */
  label: string
  /** The chats holding this concept. Its length IS the chat count. */
  chatIds: string[]
}

export type GraphChat = {
  id: string
  title: string
  messageCount: number
  /** The chat's memory: verbatim sentences, newest first, separated by RECORD_SEPARATOR. */
  compaction: string
  /**
   * Whether `deriveTitle` cut this title at its 60-character cap.
   *
   * Carried rather than recomputed, because working it out needs the first
   * message and the view has only the title. Without it a cut title reads as a
   * rendering bug instead of a derived name.
   */
  titleTruncated: boolean
  /**
   * Concepts the user deleted from this conversation.
   *
   * Optional because Forgetting ships in the demo first: the app's loader does
   * not supply it yet, and a required field would have broken it for a feature
   * it does not have. A view that receives none simply offers no delete.
   */
  forgotten?: string[]
}

export type ViewGraph = {
  chats: GraphChat[]
  nodes: GraphNode[]
}
