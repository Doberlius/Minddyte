/**
 * The labelled set for retrieval evaluation.
 *
 * Each case is a question you might really ask, the conversation you would ask
 * it from, and the conversations that SHOULD come back. The last part is the
 * expensive part: it is a human judgement and nothing can generate it for you.
 * A case whose `expect` was written by reading the retriever's own output
 * measures nothing — label from the question, before looking.
 *
 * Conversations are named by TITLE rather than id, because a uuid cannot be
 * checked by eye and this file is meant to be edited by a person. The runner
 * reports any title it cannot resolve instead of silently scoring zero.
 *
 * ## Why this file is nearly empty
 *
 * As of 2026-09-22 the database holds four conversations, six concepts and no
 * concept shared by more than one of them — smoke-test data. There is nothing
 * for retrieval to get right or wrong yet, so there are no honest cases to
 * write. The runner refuses to print a score until the corpus can carry one;
 * see `scripts/eval-retrieval.ts`.
 *
 * Fill this in after using the app for real. The example below shows the
 * shape and is skipped by default.
 */

export type RetrievalCase = {
  /** What you would type. */
  question: string
  /** The conversation you are typing it into, by title. */
  from: string
  /**
   * Titles of the conversations that should come back, best first.
   *
   * Order is used for MRR and nothing else — the retriever is not required to
   * match it, only to return these rather than others.
   */
  expect: string[]
  /** Conversations brought in by hand with `@`, by title. */
  tag?: string[]
  /** Defaults to explore, which is the app's default. */
  mode?: 'focus' | 'explore'
  /** Set while a case is being written or disputed. Skipped, and counted. */
  draft?: boolean
}

export const CASES: RetrievalCase[] = [
  {
    question: 'Remind me why we did not go with a message queue for this.',
    from: 'Rewriting the ingest path',
    expect: ['Kafka versus a cron job', 'Why the ingest path is synchronous'],
    draft: true,
  },
]
