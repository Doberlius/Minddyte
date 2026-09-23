/**
 * The six-step ranking chain. Spec §6.3.
 * Pure — no database import, so it is fully unit-testable.
 *
 * A total order that cannot tie. Determinism demands a final backstop.
 */

export type SharedNode = {
  label: string
  /** How many Chats hold this Node — from nodes.chat_count. Spec §3.1. */
  chatCount: number
  /** Is this Node the candidate Chat's Headline? Spec §6.3 step 2. */
  isHeadlineOfCandidate: boolean
}

export type CandidateKind = 'bridge' | 'strong-text' | 'overlap' | 'text'

export type Candidate = {
  chatId: string
  kind: CandidateKind
  sharedNodes: SharedNode[]
  /** The text-match score for the text tiers: strict similarity for strong-text, word similarity for text. */
  textScore?: number
  /** epoch ms */
  lastReferencedAt: number
  /** epoch ms */
  createdAt: number
}

/** Spec §6.2 — a count, not a token budget. Predictable where a budget is not. */
export const AUTO_REACH_CAP = 3

/**
 * Ticket 05, the total order: tagged > strong text evidence > node overlap >
 * ordinary text match. A tier, not a bonus — "you connected this" or "matches
 * the exact phrase" is explainable; a summed score across different scales is
 * not (§6.4).
 */
const TIER: Record<CandidateKind, number> = { bridge: 0, 'strong-text': 1, overlap: 2, text: 3 }

/**
 * Rarity: a Node in 15 Chats is weak evidence; one in 2 is strong.
 * Weighting, never a hard cutoff — a cutoff makes a Node silently stop
 * working with no visible cause. Spec §6.3.
 */
function score(c: Candidate): number {
  return c.sharedNodes.reduce((sum, n) => sum + 1 / Math.max(1, n.chatCount), 0)
}

export function rankCandidates(candidates: Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => {
    // 1. The tier decides first.
    if (a.kind !== b.kind) return TIER[a.kind] - TIER[b.kind]
    if (a.kind === 'strong-text' || a.kind === 'text') {
      // 2t. Within a text tier: the better match.
      const t = (b.textScore ?? 0) - (a.textScore ?? 0)
      if (t !== 0) return t
    } else {
      // 2. Headline bonus — a Chat that is ABOUT the shared Node beats one
      //    merely mentioning it, even where the other shares more Nodes. Spec §6.3.
      const aHeadline = a.sharedNodes.some((n) => n.isHeadlineOfCandidate)
      const bHeadline = b.sharedNodes.some((n) => n.isHeadlineOfCandidate)
      if (aHeadline !== bHeadline) return aHeadline ? -1 : 1
      // 3. Shared-Node count × rarity.
      const d = score(b) - score(a)
      if (d !== 0) return d
    }
    // 4. More recently referenced.
    if (a.lastReferencedAt !== b.lastReferencedAt) return b.lastReferencedAt - a.lastReferencedAt
    // 5. Older chat wins.
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
    // 6. Backstop — determinism demands one. Equal ids are the same Chat:
    //    returning 0 is deterministic because sort has been stable since ES2019.
    return a.chatId < b.chatId ? -1 : a.chatId > b.chatId ? 1 : 0
  })
}
