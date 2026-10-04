import { getDb, messages, sessions, messageNodes, chatPointers } from "../../db"
import { eq, and, sql } from "drizzle-orm"
import { extractConcepts } from "@/lib/extract"
import { deriveTitle, canonicalKey } from "@/lib/text"
import { pointerRows, type SkippedSpan } from "@/lib/pointers"
import { linkNode, forgottenKeys, headlineCandidates, type Tx } from "./links"

export type Skip = SkippedSpan & { messageId: string }

/**
 * Index one message's passages. Inside the caller's transaction, so a chat's
 * pointers and its graph writes land together or not at all.
 * `onConflictDoNothing` makes a repeat ingest (or the backfill racing a live
 * one) harmless: the primary key is (message_id, ordinal).
 */
async function writePointers(
  tx: Tx,
  input: { workspaceId: string; sessionId: string; messageId: string; content: string; pointerShift?: number },
): Promise<Skip[]> {
  const { rows, skipped } = pointerRows(input.content, undefined, input.pointerShift ?? 0)
  if (rows.length > 0) {
    await tx
      .insert(chatPointers)
      .values(rows.map((r) => ({ ...r, workspaceId: input.workspaceId, sessionId: input.sessionId, messageId: input.messageId })))
      .onConflictDoNothing()
  }
  return skipped.map((s) => ({ ...s, messageId: input.messageId }))
}

/**
 * Replace one message's passages after its content changed (a repaired
 * diagram, spec §8). Pointers address the message by offset, so any change in
 * length shifts every later sentence: delete them all, write them again.
 */
export async function rewritePointers(
  tx: Tx,
  input: { workspaceId: string; sessionId: string; messageId: string; content: string },
): Promise<Skip[]> {
  await tx.delete(chatPointers).where(eq(chatPointers.messageId, input.messageId))
  return writePointers(tx, input)
}

export async function persistMessage(input: {
  workspaceId: string
  sessionId: string
  role: "user" | "assistant"
  content: string
  modelUsed?: string
  /** Chosen by the caller when the browser must know it in advance (the chat route). */
  id?: string
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

  const values = {
    sessionId: input.sessionId,
    role: input.role,
    content: input.content,
    modelUsed: input.modelUsed ?? null,
  }
  // The browser chooses the user message's id (message-actions ticket 01), so
  // it can name the message in a delete without a reload. An id already taken
  // — a replayed request, an old tab — must not fail the send: it gets a fresh
  // id, and that one message is only addressable after a reload.
  if (input.id) {
    const [row] = await db.insert(messages).values({ ...values, id: input.id }).onConflictDoNothing().returning({ id: messages.id })
    if (row) return row.id
  }
  const [row] = await db.insert(messages).values(values).returning({ id: messages.id })
  return row.id
}

/**
 * The route's after-stream write (spec §4.5): save the reply, then index the
 * turn. Skipped entirely when the question is no longer there — deleted while
 * the reply streamed (message-actions ticket 01) — so a reply never outlives
 * its question. Returns null when skipped.
 */
export async function finishTurn(input: {
  workspaceId: string
  sessionId: string
  messageId: string
  memoryDraft: string
  text: string
  modelId: string
  assistantMessageId: string
  pointerShift: number
}): Promise<{ skipped: Skip[] } | null> {
  const db = await getDb()
  const [still] = await db.select({ id: messages.id }).from(messages).where(eq(messages.id, input.messageId))
  if (!still) return null
  const saved = await persistMessage({
    workspaceId: input.workspaceId, sessionId: input.sessionId, role: 'assistant',
    content: input.text, modelUsed: input.modelId, id: input.assistantMessageId,
  })
  return ingestUserMessage({
    workspaceId: input.workspaceId, sessionId: input.sessionId, messageId: input.messageId,
    content: input.memoryDraft,
    // Pointers take both roles; extraction stays user-only (spec §4.2).
    assistantContent: input.text,
    assistantMessageId: saved,
    pointerShift: input.pointerShift,
  })
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
  /**
   * A code-point offset added to every pointer built from `content` — 0 for
   * every caller except a `/visualize` user message. Pointers are offsets
   * read back from the STORED row (retrieval.ts, forget.ts), but `content`
   * here is `memoryDraft` (the command already stripped, so `match_text`
   * stays clean and extraction never sees "visualize" as a concept — spec
   * §3/§4.2) — shorter than what was actually persisted by exactly
   * `visualizePrefixLength(draft)` characters. Passing that length as
   * `pointerShift` moves every offset `content` produced back onto the same
   * characters in the stored row.
   */
  pointerShift?: number
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

    // Ticket 10, Q4: a concept forgotten in this chat stays forgotten. Later
    // mentions are still said and still readable; they never re-link it.
    const skip = await forgottenKeys(tx, input.sessionId)

    for (const label of auto) {
      if (skip.has(canonicalKey(label))) continue
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
      // headlineCandidates(content)[0] is exactly extractConcepts(title).auto[0] ?? auto[0]:
      // the title IS deriveTitle(content). Shared with rederiveHeadline (Q13).
      const headlineLabel = headlineCandidates(input.content).find((l) => !skip.has(canonicalKey(l))) ?? null

      const headlineNodeId = headlineLabel
        ? await linkNode(tx, input.workspaceId, input.sessionId, headlineLabel)
        : null

      // The title only replaces the new-chat name. A chat emptied by deleting
      // every turn (message-actions ticket 01) counts its next message as the
      // first again, but a name the user chose for it stays.
      await tx
        .update(sessions)
        .set({ title: sql`case when ${sessions.title} = ${deriveTitle("")} then ${title} else ${sessions.title} end`, headlineNodeId })
        .where(and(eq(sessions.id, input.sessionId), eq(sessions.workspaceId, input.workspaceId)))
    }

    // Pointers for both roles. The ownership guard at the top of this
    // transaction already threw for a foreign sessionId, so these writes
    // inherit that same proof rather than re-reading the session to get it.
    const skipped = [
      ...(await writePointers(tx, { ...input, messageId: input.messageId, content: input.content, pointerShift: input.pointerShift })),
      ...(input.assistantContent && input.assistantMessageId
        // The reply is never a `/visualize` command, so it never needs a shift
        // — explicitly 0 rather than inheriting `input.pointerShift` from the
        // spread below, which describes the USER message only.
        ? await writePointers(tx, { ...input, messageId: input.assistantMessageId, content: input.assistantContent, pointerShift: 0 })
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
