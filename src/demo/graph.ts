import { extractConcepts } from '@/lib/extract'
import { canonicalKey, deriveTitle } from '@/lib/text'
import { appendToCompaction } from '@/lib/compaction'

/**
 * The demo's graph, held in memory.
 *
 * This is `services/graph.ts#ingestUserMessage` with the database taken out —
 * the same rules, expressed against arrays instead of SQL. It exists because
 * the live demo has to run with no server, no PGlite and no wasm, and the
 * whole point of the demo is that the graph is built by real code rather than
 * mocked up.
 *
 * What it does NOT reproduce: persistence, rarity-weighted retrieval
 * (`lib/rank.ts` ranks across a corpus this has no equivalent of), Forgetting,
 * archival, and Bridges. Those live in the app and stay there. Everything this
 * DOES claim to do is asserted against the real extractor in
 * `tests/demo/graph.test.ts`.
 *
 * Every function returns a new graph. React re-renders on identity, and an
 * in-place mutation here would leave the canvas showing the previous frame.
 */

export type DemoMessage = { role: 'user' | 'assistant'; content: string }

export type DemoChat = {
  id: string
  title: string
  messages: DemoMessage[]
  /** What the assistant would receive as this chat's memory. Verbatim sentences. */
  compaction: string
  /** The Node taken from the title; names this chat wherever it appears. */
  headlineKey: string | null
}

export type DemoNode = {
  /** Identity within the graph: the label lowercased with non-alphanumerics stripped. */
  key: string
  /** The first label that produced this key. Later spellings never overwrite it. */
  label: string
  /** The chats holding this Node. Its length IS the chat count. */
  chatIds: string[]
}

export type DemoGraph = {
  chats: DemoChat[]
  nodes: DemoNode[]
}

/** Two chats and every Node they have in common. Nobody drew these — they follow from content. */
export type Overlap = { a: string; b: string; keys: string[] }

export function emptyGraph(): DemoGraph {
  return { chats: [], nodes: [] }
}

export function nodeByKey(graph: DemoGraph, key: string): DemoNode | undefined {
  return graph.nodes.find((n) => n.key === key)
}

export function chatById(graph: DemoGraph, id: string): DemoChat | undefined {
  return graph.chats.find((c) => c.id === id)
}

/**
 * Find-or-create the Node for `label`, and link it to this chat.
 *
 * Mirrors `upsertNodeAndLink`: the canonical key is the dedup, and a chat is
 * counted once however often it names the same concept. A label that
 * canonicalizes to nothing (say "...") must never become a Node, so it is
 * dropped rather than stored under an empty key.
 *
 * Mutates `nodes`, which is safe because the caller only ever passes a fresh
 * copy it owns.
 */
function upsertNodeAndLink(nodes: DemoNode[], chatId: string, label: string): string | null {
  const key = canonicalKey(label)
  if (!key) return null

  const existing = nodes.find((n) => n.key === key)
  if (!existing) {
    nodes.push({ key, label, chatIds: [chatId] })
    return key
  }

  // The first label wins. "PostgreSQL" and "postgresql" are the same Node, and
  // re-labelling it on every sighting would make the canvas flicker between
  // spellings for no gain.
  if (!existing.chatIds.includes(chatId)) {
    existing.chatIds = [...existing.chatIds, chatId]
  }
  return key
}

/**
 * Send one message and fold everything it contributes into the graph.
 *
 * `assistantText` reaches the Compaction and nothing else. Spec §4.1 takes both
 * roles into memory — a memory built from questions alone records what was
 * asked, never what was concluded — but extraction stays user-only, because a
 * reply runs to hundreds of words and would swamp the index with concepts the
 * user never raised.
 */
export function sendMessage(
  graph: DemoGraph,
  input: { chatId: string; userText: string; assistantText?: string },
): DemoGraph {
  const { chatId, userText, assistantText } = input

  const nodes = graph.nodes.map((n) => ({ ...n }))
  const prior = chatById(graph, chatId)
  const isFirstMessage = !prior || !prior.messages.some((m) => m.role === 'user')

  const { auto } = extractConcepts(userText)
  for (const label of auto) upsertNodeAndLink(nodes, chatId, label)

  // Title and Headline are derived ONCE, from the first user message. Renaming
  // a chat later never re-runs this, which is why it is gated rather than
  // recomputed — a chat's name should not shift under the user as it grows.
  let title = prior?.title ?? 'New Session'
  let headlineKey = prior?.headlineKey ?? null
  if (isFirstMessage) {
    title = deriveTitle(userText)
    const headlineLabel = extractConcepts(title).auto[0] ?? auto[0] ?? null
    headlineKey = headlineLabel ? upsertNodeAndLink(nodes, chatId, headlineLabel) : null
  }

  // appendToCompaction PREPENDS, so the assistant's reply goes in first and the
  // user's message second. That leaves the user's sentences at the front, where
  // they survive trimming longest.
  const withAssistant = assistantText
    ? appendToCompaction(prior?.compaction ?? '', assistantText)
    : (prior?.compaction ?? '')
  const compaction = appendToCompaction(withAssistant, userText)

  const messages: DemoMessage[] = [
    ...(prior?.messages ?? []),
    { role: 'user' as const, content: userText },
    ...(assistantText ? [{ role: 'assistant' as const, content: assistantText }] : []),
  ]

  const updated: DemoChat = { id: chatId, title, messages, compaction, headlineKey }
  const chats = prior
    ? graph.chats.map((c) => (c.id === chatId ? updated : c))
    : [...graph.chats, updated]

  return { chats, nodes }
}

/**
 * The connections that simply follow from content: two chats holding the same
 * Node. One entry per pair, carrying every key they share, so the canvas draws
 * a single edge whose weight is `keys.length` rather than a bundle of parallel
 * lines nobody can read.
 */
export function overlaps(graph: DemoGraph): Overlap[] {
  const pairs = new Map<string, Overlap>()

  for (const node of graph.nodes) {
    if (node.chatIds.length < 2) continue
    for (let i = 0; i < node.chatIds.length; i++) {
      for (let j = i + 1; j < node.chatIds.length; j++) {
        const a = node.chatIds[i]
        const b = node.chatIds[j]
        const id = `${a}|${b}`
        const found = pairs.get(id)
        if (found) found.keys.push(node.key)
        else pairs.set(id, { a, b, keys: [node.key] })
      }
    }
  }

  return [...pairs.values()]
}
