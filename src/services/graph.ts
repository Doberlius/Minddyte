import { db, messages, nodes, sessions, sessionNodes, messageNodes } from "../../db"
import { eq, and, sql } from "drizzle-orm"
import { extractConcepts } from "@/lib/extract"
import { canonicalKey, deriveTitle } from "@/lib/text"
import { appendToCompaction } from "@/lib/compaction"

/** The type of the `tx` argument `db.transaction(async (tx) => ...)` hands us. */
type Tx = Parameters<typeof db.transaction>[0] extends (tx: infer T, ...rest: any[]) => any
  ? T
  : never

export async function persistMessage(input: {
  sessionId: string
  userId: string
  role: "user" | "assistant"
  content: string
  modelUsed?: string
}): Promise<string> {
  const [row] = await db
    .insert(messages)
    .values({
      sessionId: input.sessionId,
      userId: input.userId,
      role: input.role,
      content: input.content,
      modelUsed: input.modelUsed ?? null,
    })
    .returning({ id: messages.id })
  return row.id
}

/**
 * Upsert a Node for `label` and make sure it is linked to this Chat.
 *
 * This is the single place that implements the dedup + linking + rarity
 * bookkeeping shared by both callers in `ingestUserMessage` (the per-message
 * concept loop and the once-only Headline derivation): find-or-create the
 * Node by its canonical key (the unique constraint IS the dedup, spec §4.3),
 * link it to the session, and bump `chat_count` ONLY when that link is new
 * (spec §3.1) — never on every message, or rarity weighting in Task 7 would
 * be corrupted.
 *
 * Returns the Node's id, or null when `label` canonicalizes to an empty
 * string (e.g. a label like "..." with no alphanumeric characters) — such a
 * label must never become a Node.
 */
async function upsertNodeAndLink(
  tx: Tx,
  userId: string,
  sessionId: string,
  label: string
): Promise<string | null> {
  const key = canonicalKey(label)
  if (!key) return null

  // The unique constraint IS the dedup. Spec §4.3.
  const [node] = await tx
    .insert(nodes)
    .values({ userId, label, canonicalKey: key })
    .onConflictDoUpdate({
      target: [nodes.userId, nodes.canonicalKey],
      set: { lastReferencedAt: new Date() },
    })
    .returning({ id: nodes.id })

  const linked = await tx
    .insert(sessionNodes)
    .values({ sessionId, nodeId: node.id })
    .onConflictDoNothing()
    .returning({ nodeId: sessionNodes.nodeId })

  // chat_count only moves when the link is NEW. Spec §3.1.
  if (linked.length > 0) {
    await tx
      .update(nodes)
      .set({ chatCount: sql`${nodes.chatCount} + 1` })
      .where(eq(nodes.id, node.id))
  }

  return node.id
}

/**
 * The graph write path. Spec §4.5 — this runs AFTER the response has streamed.
 * Nothing the model needs depends on it, and running it first would add
 * 300-500ms to time-to-first-token.
 */
export async function ingestUserMessage(input: {
  sessionId: string
  userId: string
  messageId: string
  content: string
  /** True only for a Chat's very first user message — drives title + Headline. */
  isFirstMessage: boolean
}): Promise<void> {
  const { auto } = extractConcepts(input.content)

  await db.transaction(async (tx) => {
    for (const label of auto) {
      const nodeId = await upsertNodeAndLink(tx, input.userId, input.sessionId, label)
      if (!nodeId) continue

      await tx
        .insert(messageNodes)
        .values({ messageId: input.messageId, nodeId })
        .onConflictDoNothing()
    }

    // Title and Headline, derived ONCE on the first message. Spec §4.4.
    // Renaming the Chat later never re-runs this.
    if (input.isFirstMessage) {
      const title = deriveTitle(input.content)
      const headlineLabel = extractConcepts(title).auto[0] ?? auto[0] ?? null

      const headlineNodeId = headlineLabel
        ? await upsertNodeAndLink(tx, input.userId, input.sessionId, headlineLabel)
        : null

      await tx
        .update(sessions)
        .set({ title, headlineNodeId })
        .where(eq(sessions.id, input.sessionId))
    }

    // Incremental compaction. Spec §4.1 — never re-reads history.
    const [s] = await tx
      .select({ compaction: sessions.compaction })
      .from(sessions)
      .where(and(eq(sessions.id, input.sessionId), eq(sessions.userId, input.userId)))

    if (s) {
      await tx
        .update(sessions)
        .set({
          compaction: appendToCompaction(s.compaction, input.content),
          compactionUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, input.sessionId))
    }
  })
}
