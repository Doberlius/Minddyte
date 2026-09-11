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

export type Candidate = {
  chatId: string
  kind: 'bridge' | 'overlap'
  sharedNodes: SharedNode[]
  /** epoch ms */
  lastReferencedAt: number
  /** epoch ms */
  createdAt: number
}

/** Spec §6.2 — a count, not a token budget. Predictable where a budget is not. */
export const AUTO_REACH_CAP = 3

/** Bonus when a shared Node is what the candidate Chat is *about*. */
const HEADLINE_BONUS = 10

/**
 * Rarity: a Node in 15 Chats is weak evidence; one in 2 is strong.
 * Weighting, never a hard cutoff — a cutoff makes a Node silently stop
 * working with no visible cause. Spec §6.3.
 */
function score(c: Candidate): number {
  return c.sharedNodes.reduce(
    (sum, n) => sum + 1 / Math.max(1, n.chatCount) + (n.isHeadlineOfCandidate ? HEADLINE_BONUS : 0),
    0,
  )
}

export function rankCandidates(candidates: Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => {
    // 1. Bridges are louder, not longer — authored beats derived.
    if (a.kind !== b.kind) return a.kind === 'bridge' ? -1 : 1
    // 2 + 3. Headline bonus and shared-node count × rarity, combined in score().
    const d = score(b) - score(a)
    if (d !== 0) return d
    // 4. More recently referenced.
    if (a.lastReferencedAt !== b.lastReferencedAt) return b.lastReferencedAt - a.lastReferencedAt
    // 5. Older chat wins.
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
    // 6. Backstop — determinism demands one.
    return a.chatId < b.chatId ? -1 : 1
  })
}
