import { getDb, messages, sessions, messageNodes, chatPointers } from "../../db"
import { eq, and, sql } from "drizzle-orm"
import { extractConcepts } from "@/lib/extract"
import { deriveTitle } from "@/lib/text"
import { pointerRows, type SkippedSpan } from "@/lib/pointers"
import { linkNode, type Tx } from "./links"

export type Skip = SkippedSpan & { messageId: string }

/**
 * Index one message's passages. Inside the caller's transaction, so a chat's
 * pointers and its graph writes land together or not at all.
 * `onConflictDoNothing` makes a repeat ingest (or the backfill racing a live
 * one) harmless: the primary key is (message_id, ordinal).
 */
async function writePointers(
  tx: Tx,
  input: { workspaceId: string; sessionId: string; messageId: string; content: string },
): Promise<Skip[]> {
  const { rows, skipped } = pointerRows(input.content)
  if (rows.length > 0) {
    await tx
      .insert(chatPointers)
      .values(rows.map((r) => ({ ...r, workspaceId: input.workspaceId, sessionId: input.sessionId, messageId: input.messageId })))
      .onConflictDoNothing()
  }
  return skipped.map((s) => ({ ...s, messageId: input.messageId }))
}

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
   * The assistant's reply to this message, for its own pointers only.
   *
   * Spec §4.1 takes BOTH roles into memory — a memory built from questions
   * alone records what was asked, never what was concluded. Extraction is a
   * separate concern and stays user-only (spec §4.2): an assistant reply runs
   * to hundreds of words and would swamp the index with concepts the user
   * never raised. So this text reaches writePointers and nothing else — never
   * extractConcepts.
   */
  assistantContent?: string
  /** The assistant message's own id — its pointers point into THAT row. */
  assistantMessageId?: string
}): Promise<{ skipped: Skip[] }> {
  const { auto } = extractConcepts(input.content)

  const db = await getDb()
  return db.transaction(async (tx) => {
    // `linkNode` inserts into `session_nodes` with `input.sessionId`
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
      const nodeId = await linkNode(tx, input.workspaceId, input.sessionId, label)
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
        ? await linkNode(tx, input.workspaceId, input.sessionId, headlineLabel)
        : null

      await tx
        .update(sessions)
        .set({ title, headlineNodeId })
        .where(and(eq(sessions.id, input.sessionId), eq(sessions.workspaceId, input.workspaceId)))
    }

    // Pointers for both roles. The ownership guard at the top of this
    // transaction already threw for a foreign sessionId, so these writes
    // inherit that same proof rather than re-reading the session to get it.
    const skipped = [
      ...(await writePointers(tx, { ...input, messageId: input.messageId, content: input.content })),
      ...(input.assistantContent && input.assistantMessageId
        ? await writePointers(tx, { ...input, messageId: input.assistantMessageId, content: input.assistantContent })
        : []),
    ]

    // Chat lists sort by updatedAt. The Compaction used to update alongside
    // it in this same statement; that write is gone, this one stays.
    await tx
      .update(sessions)
      .set({ updatedAt: new Date() })
      .where(and(eq(sessions.id, input.sessionId), eq(sessions.workspaceId, input.workspaceId)))

    return { skipped }
  })
}
