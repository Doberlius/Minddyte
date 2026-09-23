import { getDb, type Db, messages, nodes, sessions, sessionNodes, messageNodes } from "../../db"
import { eq, and, sql } from "drizzle-orm"
import { extractConcepts } from "@/lib/extract"
import { canonicalKey, deriveTitle } from "@/lib/text"
import { appendToCompaction, whyNotRemembered } from "@/lib/compaction"

/** The type of the `tx` argument `db.transaction(async (tx) => ...)` hands us. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

export async function persistMessage(input: {
  workspaceId: string
  sessionId: string
  role: "user" | "assistant"
  content: string
  modelUsed?: string
}): Promise<string> {
  const db = await getDb()

  // messages carries no workspace_id of its own — it inherits one through
  // sessionId's foreign key. So the only way to keep a stranger's sessionId
  // from writing into this workspace's chat is to check ownership here,
  // before the insert, rather than trust the column to enforce it.
  const [owned] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, input.sessionId), eq(sessions.workspaceId, input.workspaceId)))

  if (!owned) {
    // Never fail blankly — but never confirm the row exists elsewhere
    // either. "Not yours" and "not there" must be indistinguishable from
    // outside, or the error becomes a way to ask whether a chat id is real.
    throw new Error(`No chat ${input.sessionId} in this workspace.`)
  }

  const [row] = await db
    .insert(messages)
    .values({
      sessionId: input.sessionId,
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
  workspaceId: string,
  sessionId: string,
  label: string
): Promise<string | null> {
  const key = canonicalKey(label)
  if (!key) return null

  // The unique constraint IS the dedup, and it is now composite — so the
  // conflict target has to name both columns. Naming only canonicalKey here
  // would fail at runtime against a constraint that no longer exists, which
  // is the better of the two failures available: the alternative is that it
  // silently matches some other workspace's row.
  const [node] = await tx
    .insert(nodes)
    .values({ workspaceId, label, canonicalKey: key })
    .onConflictDoUpdate({
      target: [nodes.workspaceId, nodes.canonicalKey],
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
  workspaceId: string
  sessionId: string
  messageId: string
  content: string
  /**
   * The assistant's reply to this message, for the Compaction only.
   *
   * Spec §4.1 takes BOTH roles into the Compaction — a memory built from
   * questions alone records what was asked, never what was concluded.
   * Extraction is a separate concern and stays user-only (spec §4.2): an
   * assistant reply runs to hundreds of words and would swamp the index
   * with concepts the user never raised. So this text reaches
   * appendToCompaction and nothing else — never extractConcepts.
   */
  assistantContent?: string
}): Promise<{ notRemembered: ReturnType<typeof whyNotRemembered> }> {
  const { auto } = extractConcepts(input.content)

  const db = await getDb()
  return db.transaction(async (tx) => {
    // `upsertNodeAndLink` inserts into `session_nodes` with `input.sessionId`
    // and never proves it belongs to `input.workspaceId` itself — it trusts
    // its caller. Today the chat route proves that upstream (it only ever
    // calls in with a session it already loaded for this workspace), so
    // nothing exploits this yet, but that makes it latent rather than safe:
    // the moment any other caller reaches this function with an unproven
    // pair, every node/session filter downstream stops being redundant and
    // starts being the only thing standing between a foreign sessionId and
    // this workspace's chat. Same check persistMessage already does, same
    // non-distinguishing message — "not yours" and "not there" must stay
    // indistinguishable from outside.
    const [owned] = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, input.sessionId), eq(sessions.workspaceId, input.workspaceId)))

    if (!owned) {
      throw new Error(`No chat ${input.sessionId} in this workspace.`)
    }

    for (const label of auto) {
      const nodeId = await upsertNodeAndLink(tx, input.workspaceId, input.sessionId, label)
      if (!nodeId) continue

      await tx
        .insert(messageNodes)
        .values({ messageId: input.messageId, nodeId })
        .onConflictDoNothing()
    }

    // Spec §4.4 — derived ONCE, from server state. route.ts persists the user
    // message BEFORE streaming, so a count of exactly 1 means this really is the
    // chat's first user message. Trusting the client's array length here would let
    // a reload or a truncated history silently re-derive an existing chat's title.
    const [counted] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(messages)
      .where(and(eq(messages.sessionId, input.sessionId), eq(messages.role, "user")))
    const isFirstMessage = counted.n === 1

    // Title and Headline, derived ONCE on the first message. Spec §4.4.
    // Renaming the Chat later never re-runs this.
    if (isFirstMessage) {
      const title = deriveTitle(input.content)
      const headlineLabel = extractConcepts(title).auto[0] ?? auto[0] ?? null

      const headlineNodeId = headlineLabel
        ? await upsertNodeAndLink(tx, input.workspaceId, input.sessionId, headlineLabel)
        : null

      await tx
        .update(sessions)
        .set({ title, headlineNodeId })
        .where(and(eq(sessions.id, input.sessionId), eq(sessions.workspaceId, input.workspaceId)))
    }

    // Incremental compaction. Spec §4.1 — never re-reads history.
    //
    // This read used to carry `.for('update')`, which locked the session row so
    // two overlapping ingests could not both read the same compaction and have
    // the second write silently overwrite the first. PGlite is single-connection
    // by architecture, so two transactions physically cannot overlap and the
    // clause did nothing. Recorded cost: the lost-update race returns the moment
    // anything reintroduces concurrent writers to one session — a hosted variant
    // would have to put this back, with a reason attached.
    const [s] = await tx
      .select({ compaction: sessions.compaction })
      .from(sessions)
      .where(and(eq(sessions.id, input.sessionId), eq(sessions.workspaceId, input.workspaceId)))

    if (s) {
      // Both roles, the user's first. appendToCompaction PREPENDS, so the
      // assistant's reply goes in first and the user's message second —
      // leaving the user's sentences at the front, where they survive
      // trimming longest. Spec §4.1. buildCompaction's doc comment carries
      // the matching rebuild order; the invariant test asserts they agree.
      const withAssistant = input.assistantContent
        ? appendToCompaction(s.compaction, input.assistantContent)
        : s.compaction

      const compaction = appendToCompaction(withAssistant, input.content)
      await tx
        .update(sessions)
        .set({
          compaction,
          compactionUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(sessions.id, input.sessionId), eq(sessions.workspaceId, input.workspaceId)))

      // Ticket 11, decision 3 — never silent. Returned rather than logged here
      // so the caller decides how to surface it, and so a test can assert it.
      // Only the USER's message is checked: a reply that loses the cap to the
      // user's own sentences is the design working (spec §4.1), not a loss.
      return { notRemembered: whyNotRemembered(input.content, compaction) }
    }
    return { notRemembered: null }
  })
}
