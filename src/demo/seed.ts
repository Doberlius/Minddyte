import { emptyGraph, sendMessage, type DemoGraph } from './graph'

/**
 * The conversations the demo opens with.
 *
 * These are not decoration. A visitor forms their opinion of Minddyte from the
 * first frame, and an empty canvas says nothing, so the seed has to show the
 * one thing the product claims: that separate conversations grow shared
 * structure without anyone filing them.
 *
 * The wording is CONSTRAINED BY THE REAL EXTRACTOR, which is why it reads the
 * way it does. `lib/extract.ts` keys a Node on its whole noun phrase, so
 * "Rust" and "Rust ownership" are different Nodes and do not connect. Every
 * concept meant to be shared therefore appears as a bare technology name in
 * each chat that holds it. This was arrived at by running the sentences
 * through `extractConcepts` and reading what came back — see
 * `tests/demo/seed.test.ts`, which fails if a future extractor change breaks
 * the overlaps these conversations exist to demonstrate.
 *
 * The assistant replies are written, not generated. They are here so the
 * Compaction has both roles to work with; the demo says so on screen.
 */

export type SeedTurn = { user: string; assistant: string }
export type SeedChat = { id: string; turns: SeedTurn[] }

export const SEED_CHATS: SeedChat[] = [
  {
    id: 'db',
    turns: [
      {
        user: 'We decided to use PostgreSQL because the data has a clear relational schema.',
        assistant: 'Relational integrity matters once rows reference each other.',
      },
      {
        user: 'Is PostgreSQL a good fit for storing a graph of concepts?',
        assistant: 'It is, as long as the graph stays bipartite and you index the join table.',
      },
    ],
  },
  {
    id: 'lang',
    turns: [
      {
        user: 'I am comparing Go and Rust for a high throughput API server.',
        assistant: 'Both are strong here. Go ships faster, Rust gives tighter control.',
      },
      {
        user: 'Go pauses for a garbage collector, and Rust does not.',
        assistant: 'That is the trade you are weighing.',
      },
    ],
  },
  {
    id: 'infra',
    turns: [
      {
        user: 'Docker Compose runs PostgreSQL locally for me.',
        assistant: 'That keeps development and production aligned.',
      },
      {
        user: 'Kubernetes feels heavy for a team of three.',
        assistant: 'It usually is, until you need rolling deploys.',
      },
    ],
  },
  {
    id: 'safety',
    turns: [
      {
        user: 'Rust has no garbage collector. Ownership decides when memory is freed.',
        assistant: 'The borrow checker proves that before the program ever runs.',
      },
    ],
  },
  {
    id: 'deploy',
    turns: [
      {
        user: 'We deploy with Docker Compose today, but Kubernetes is the plan.',
        assistant: 'A staged migration is sensible.',
      },
      {
        user: 'PostgreSQL stays managed either way.',
        assistant: 'Good call. Running it yourself is real work.',
      },
    ],
  },
]

/** The seed folded through the real ingest path, exactly as a typed message is. */
export function seededGraph(): DemoGraph {
  let graph = emptyGraph()
  for (const chat of SEED_CHATS) {
    for (const turn of chat.turns) {
      graph = sendMessage(graph, {
        chatId: chat.id,
        userText: turn.user,
        assistantText: turn.assistant,
      })
    }
  }
  return graph
}
