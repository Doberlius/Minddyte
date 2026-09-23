import { extractConcepts } from '@/lib/extract'
import { canonicalKey, deriveTitle } from '@/lib/text'
import { appendToCompaction, buildCompaction, type Turn } from '@/lib/compaction'
import { proseSentences } from '@/lib/prose'
// Shared with the app, which computes the same links over database rows.
export { overlaps, type Overlap } from '@/lib/graph-overlaps'

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
 * (`lib/rank.ts` ranks across a corpus this has no equivalent of), archival,
 * and Bridges. Those live in the app and stay there. Forgetting IS here —
 * it is the one place a visitor can prove the memory is theirs to take back,
 * and a claim like that is worth nothing described. Everything this
 * DOES claim to do is asserted against the real extractor in
 * `tests/demo/graph.test.ts`.
 *
 * Every function returns a new graph. React re-renders on identity, and an
 * in-place mutation here would leave the canvas showing the previous frame.
 */

export type DemoMessage = {
  role: 'user' | 'assistant'
  content: string
  /**
   * Whether this message counts toward the chat's memory.
   *
   * Only ever false for the demo's own reports about the extractor. It has to
   * be recorded on the message rather than inferred, because Forgetting
   * rebuilds the Compaction from the transcript and cannot otherwise tell
   * which replies were meant to be remembered.
   */
  remembered?: boolean
}

export type DemoChat = {
  id: string
  title: string
  messages: DemoMessage[]
  /** What the assistant would receive as this chat's memory. Verbatim sentences. */
  compaction: string
  /** The Node taken from the title; names this chat wherever it appears. */
  headlineKey: string | null
  /**
   * Labels the user has deleted from this chat.
   *
   * Kept as LABELS, not keys, because they are matched against the text of
   * sentences — and kept forever, because "permanently ineligible" is the
   * whole promise. A forgotten concept that returns the next time you mention
   * it is not a delete, it is a pause.
   */
  forgotten: string[]
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
 * The concepts some chat OTHER than this one already holds.
 *
 * This is what "connected" has to mean, and a set of every key in the graph is
 * not it. Saying "SDG" twice in one conversation put the key in that set the
 * first time, so the second mention was reported as linking to other
 * conversations — while the canvas, which calls a concept shared only when
 * more than one chat holds it, drew it as a lone pill. The transcript claimed
 * a link the picture did not show, in a demo whose entire argument is that the
 * links are real.
 *
 * Excluding the current chat makes the two agree by construction: a concept is
 * connected here exactly when `chatIds.length > 1` will be true there.
 */
export function keysHeldOutside(graph: DemoGraph, chatId: string): Set<string> {
  return new Set(
    graph.nodes.filter((n) => n.chatIds.some((id) => id !== chatId)).map((n) => n.key),
  )
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
  input: {
    chatId: string
    userText: string
    assistantText?: string
    /**
     * Whether the reply belongs in this chat's memory.
     *
     * True for the seeded conversations, whose replies are authored content.
     * FALSE for the demo's live turns, where the "reply" is a report about the
     * extractor rather than anything anyone said — and reports are what broke
     * the Archive: type three junk words and the memory filled with three
     * copies of "No concept was firm enough to index there. I saw daa, but a
     * single lowercase word is only ever suggested…", crowding the visitor's
     * own sentences out of a 500-character cap. The panel that exists to show
     * your words back to you was showing the demo talking to itself.
     */
    rememberAssistant?: boolean
  },
): DemoGraph {
  const { chatId, userText, assistantText, rememberAssistant = true } = input

  const nodes = graph.nodes.map((n) => ({ ...n }))
  const prior = chatById(graph, chatId)
  const isFirstMessage = !prior || !prior.messages.some((m) => m.role === 'user')
  const forgotten = prior?.forgotten ?? []

  // A concept deleted from this chat does not come back by being said again.
  const auto = extractConcepts(userText).auto.filter(
    (label) => !forgotten.some((f) => canonicalKey(f) === canonicalKey(label)),
  )
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
  const withAssistant =
    assistantText && rememberAssistant
      ? appendToCompaction(prior?.compaction ?? '', withoutForgotten(assistantText, forgotten))
      : (prior?.compaction ?? '')
  const compaction = appendToCompaction(withAssistant, withoutForgotten(userText, forgotten))

  const messages: DemoMessage[] = [
    ...(prior?.messages ?? []),
    { role: 'user' as const, content: userText },
    ...(assistantText
      ? [{ role: 'assistant' as const, content: assistantText, remembered: rememberAssistant }]
      : []),
  ]

  const updated: DemoChat = { id: chatId, title, messages, compaction, headlineKey, forgotten }
  const chats = prior
    ? graph.chats.map((c) => (c.id === chatId ? updated : c))
    : [...graph.chats, updated]

  return { chats, nodes }
}

/**
 * Does this sentence say the thing that was forgotten?
 *
 * Matched on the label's own words rather than on re-running the extractor:
 * a concept found in a whole message is not always found again in one
 * sentence of it read alone, and a Forgetting that silently keeps the
 * sentence is the failure mode that matters. Word boundaries stop "Go" from
 * taking "Google" with it.
 */
function mentions(sentence: string, label: string): boolean {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`, 'i').test(sentence)
}

/**
 * The same text with every forgotten sentence dropped — whole, never trimmed.
 *
 * Split with the Compaction's own splitter, and re-joined with blank lines so
 * each kept sentence parses back as its own paragraph. Joining with spaces
 * flattened a markdown reply into one paragraph, and headings and table rows
 * leaked back into memory in any chat where something had been forgotten.
 */
function withoutForgotten(text: string, forgotten: string[]): string {
  if (forgotten.length === 0) return text
  return proseSentences(text)
    .filter((sentence) => !forgotten.some((label) => mentions(sentence, label)))
    .join('\n\n')
}

/**
 * Rebuild a chat's memory from its own transcript.
 *
 * Forgetting is the one event that changes what ALREADY-SENT messages
 * contribute, so the incremental path cannot express it — the Compaction has
 * to be recomputed from scratch. `buildCompaction` is the app's own rebuild,
 * used here for the same reason it exists there.
 */
function rebuildCompaction(chat: DemoChat): string {
  const turns: Turn[] = []
  for (const message of chat.messages) {
    if (message.role === 'user') {
      turns.push({ user: withoutForgotten(message.content, chat.forgotten) })
    } else if (message.remembered !== false && turns.length > 0) {
      turns[turns.length - 1].assistant = withoutForgotten(message.content, chat.forgotten)
    }
  }
  return buildCompaction(turns)
}

/**
 * Delete a concept from one conversation.
 *
 * Glossary: "Deleting a Node from a Chat, which makes that Node's sentences
 * permanently ineligible for the Chat's Compaction. The message stays readable
 * in the conversation; the assistant can never see it again."
 *
 * Both halves matter. Unlinking the Node alone would take it off the canvas
 * while its sentences stayed in the memory the assistant receives — the user
 * would have been shown a deletion that did not happen. So the link goes, the
 * sentences go, and `forgotten` keeps them gone.
 *
 * The Node itself survives as long as some OTHER conversation still holds it.
 * Forgetting is scoped to a chat; it is not a purge of the word.
 */
export function forget(graph: DemoGraph, input: { chatId: string; label: string }): DemoGraph {
  const chat = chatById(graph, input.chatId)
  const key = canonicalKey(input.label)
  if (!chat || !key) return graph

  const node = graph.nodes.find((n) => n.key === key)
  if (!node || !node.chatIds.includes(chat.id)) return graph

  const nodes = graph.nodes
    .map((n) =>
      n.key === key ? { ...n, chatIds: n.chatIds.filter((id) => id !== chat.id) } : { ...n },
    )
    // A concept no conversation mentions any more is not a concept.
    .filter((n) => n.chatIds.length > 0)

  const updated: DemoChat = {
    ...chat,
    forgotten: chat.forgotten.includes(input.label)
      ? chat.forgotten
      : [...chat.forgotten, input.label],
    // A chat named after the concept it just lost keeps its title — that was
    // derived once and is the user's own words — but stops claiming a Headline
    // the graph no longer has.
    headlineKey: chat.headlineKey === key ? null : chat.headlineKey,
  }
  updated.compaction = rebuildCompaction(updated)

  return {
    chats: graph.chats.map((c) => (c.id === chat.id ? updated : c)),
    nodes,
  }
}
