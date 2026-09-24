/**
 * Every number in read-time retrieval that has NOT been calibrated.
 *
 * NOT CALIBRATED. Ticket 05, Q5: there is no real corpus yet, so these were
 * taken from prototypes (.scratch/layered-memory/prototypes/) and six decoys,
 * not measured against real questions. They live here, together, so the one
 * place to change them is obvious, and so nobody mistakes them for measured.
 *
 * Recalibrate when `bun run eval:retrieval` stops refusing — its floor is 20
 * chats, 8 shared concepts and 10 labelled cases.
 */
export const PROVISIONAL = {
  /** word_similarity(draft, passage) at or above this reaches a chat. Band that caught a paraphrase: 0.25–0.379. */
  reachWordSimilarity: 0.3,
  /** strict_word_similarity(phrase, passage) at or above this promotes a chat to the strong-text tier. */
  strongStrictSimilarity: 0.9,
  /** Passages taken from each reached chat, before ±1 neighbours are added. */
  windowsPerChat: 3,
  /** A code block or table longer than this (UTF-16 chars) is not indexed, and the skip is logged. */
  spanCharLimit: 4000,
  /**
   * Code points of the draft that text search reads: the word_similarity reach,
   * the passage scoring and the strong-phrase scan. pg_trgm rebuilds the
   * draft's trigrams for every candidate row, and a long draft shares trigrams
   * with nearly every passage, so the cost grows linearly with draft length
   * (whole-branch review: 5,000 chars took 6.6 s over 7,500 pointers). PGlite
   * is one in-process connection, so every visitor waits for it. 500 is a
   * paragraph — enough to say what the question is about.
   */
  queryCharLimit: 500,
} as const
