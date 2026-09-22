import { extractConcepts } from '@/lib/extract'
import { canonicalKey } from '@/lib/text'
import { AUTO_REACH_CAP } from '@/lib/rank'
import type { DemoGraph } from './graph'

/**
 * What the assistant would be handed, if there were an assistant.
 *
 * This is `services/retrieval.ts` with the database taken out, and it is the
 * piece of Minddyte that was hardest to see in the demo: the graph was drawn,
 * the memories were listed, and nothing ever showed the two being used
 * together. Mode and tagging had no visible consequence, which is why the
 * mode pill was removed from the demo rather than made to work.
 *
 * The rules are the app's, from spec §6.1–6.2:
 *
 * - **focus** ignores automatic reach entirely. Only what you tagged.
 * - **explore** also reaches conversations that share a concept with this one
 *   or with what you are typing, capped at `AUTO_REACH_CAP`.
 * - Tagged conversations are never capped, and never ranked away.
 *
 * What it does NOT reproduce is the ranker's recency term: `lib/rank` weighs
 * when a Node was last referenced, and the demo has no clock. Ordering here is
 * by shared-concept count, then by rarity — a concept two conversations hold
 * is stronger evidence than one that fifteen hold — then by title, so the
 * same graph always resolves the same way.
 */

export type Reached = {
  id: string
  title: string
  compaction: string
  /** Why it came back: you asked for it, or the graph offered it. */
  kind: 'tagged' | 'overlap'
  /** The concepts this conversation shares with the current one. */
  shared: string[]
}

export function demoRetrieve(
  graph: DemoGraph,
  input: {
    chatId: string
    mode: 'focus' | 'explore'
    taggedChatIds: string[]
    draftText: string
  },
): Reached[] {
  const { chatId, mode, taggedChatIds, draftText } = input
  const tagged = new Set(taggedChatIds.filter((id) => id !== chatId))

  const reached: Reached[] = []

  for (const id of tagged) {
    const chat = graph.chats.find((c) => c.id === id)
    if (chat) {
      reached.push({ id: chat.id, title: chat.title, compaction: chat.compaction, kind: 'tagged', shared: [] })
    }
  }

  if (mode === 'explore') {
    // The current chat's own concepts, plus the draft's — the draft is not a
    // Node yet (graph writes happen after the reply), but it carries the
    // intent the accumulated Nodes do not.
    const mine = new Set(
      graph.nodes.filter((n) => n.chatIds.includes(chatId)).map((n) => n.key),
    )
    for (const label of extractConcepts(draftText).auto) {
      const key = canonicalKey(label)
      if (key) mine.add(key)
    }

    const bySharing = new Map<string, { shared: string[]; rarity: number }>()
    for (const node of graph.nodes) {
      if (!mine.has(node.key)) continue
      for (const other of node.chatIds) {
        if (other === chatId || tagged.has(other)) continue
        const found = bySharing.get(other)
        if (found) {
          found.shared.push(node.label)
          found.rarity += node.chatIds.length
        } else {
          bySharing.set(other, { shared: [node.label], rarity: node.chatIds.length })
        }
      }
    }

    const ranked = [...bySharing.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort(
        (a, b) =>
          b.shared.length - a.shared.length ||
          a.rarity / a.shared.length - b.rarity / b.shared.length ||
          a.id.localeCompare(b.id),
      )
      .slice(0, AUTO_REACH_CAP)

    for (const r of ranked) {
      const chat = graph.chats.find((c) => c.id === r.id)
      if (chat) {
        reached.push({
          id: chat.id,
          title: chat.title,
          compaction: chat.compaction,
          kind: 'overlap',
          shared: r.shared,
        })
      }
    }
  }

  return reached
}
