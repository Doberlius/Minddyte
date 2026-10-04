import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '../../db'
import { forgotten, messageNodes, messages, nodes, rejectedPhrases, sessionNodes, sessions } from '../../db/schema'
import { extractConcepts } from '../lib/extract'
import { canonicalKey, deriveTitle } from '../lib/text'

/**
 * Link bookkeeping shared by ingest, deleteChat, forgetting and the
 * re-extract migration. Imports are relative and schema-only on purpose:
 * db/data-migrations.ts imports this file, and db/index.ts imports that, so a
 * runtime import of ../../db here would be a cycle.
 */

/** The type of the `tx` argument `db.transaction(async (tx) => ...)` hands us. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

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
export async function linkNode(tx: Tx, workspaceId: string, sessionId: string, label: string): Promise<string | null> {
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

/** Ticket 10, Q4: the concepts forgotten in this chat, as canonical keys. */
export async function forgottenKeys(tx: Tx, sessionId: string): Promise<Set<string>> {
  const rows = await tx.select({ label: forgotten.nodeLabel }).from(forgotten).where(eq(forgotten.sessionId, sessionId))
  return new Set(rows.map((r) => canonicalKey(r.label)).filter(Boolean))
}

/**
 * Headline candidates, in order, from a chat's ORIGINAL first user message
 * (spec §4.4). The first is exactly what ingest has always chosen.
 */
export function headlineCandidates(firstMessage: string): string[] {
  return [...extractConcepts(deriveTitle(firstMessage)).auto, ...extractConcepts(firstMessage).auto]
}

/**
 * Ticket 10, Q13: the headline is the first candidate that is still linked to
 * the chat and not forgotten, or null. Read from the first message, never the
 * title, because a rename is not a new concept.
 */
export async function rederiveHeadline(tx: Tx, workspaceId: string, sessionId: string): Promise<void> {
  const [first] = await tx
    .select({ content: messages.content })
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), eq(messages.role, 'user')))
    .orderBy(messages.createdAt, messages.id)
    .limit(1)
  const skip = await forgottenKeys(tx, sessionId)
  const linked = await tx
    .select({ id: nodes.id, key: nodes.canonicalKey })
    .from(sessionNodes)
    .innerJoin(nodes, eq(nodes.id, sessionNodes.nodeId))
    .where(and(eq(sessionNodes.sessionId, sessionId), eq(nodes.workspaceId, workspaceId)))
  const byKey = new Map(linked.map((l) => [l.key, l.id]))

  let headlineNodeId: string | null = null
  for (const label of first ? headlineCandidates(first.content) : []) {
    const key = canonicalKey(label)
    if (!key || skip.has(key)) continue
    const id = byKey.get(key)
    if (id) {
      headlineNodeId = id
      break
    }
  }
  await tx
    .update(sessions)
    .set({ headlineNodeId })
    .where(and(eq(sessions.id, sessionId), eq(sessions.workspaceId, workspaceId)))
}

/**
 * Rewrite chat_count from the links that actually remain (Q5: recount, never
 * decrement, so a count that drifted is corrected rather than drifting
 * further), then delete the concepts no chat holds (Q15). Returns the labels
 * it deleted, so a caller can say so. Scoped to the workspace because this
 * WRITES rows it did not look up by chat.
 */
export async function recountNodes(tx: Tx, workspaceId: string, nodeIds: string[]): Promise<string[]> {
  if (nodeIds.length === 0) return []
  await tx
    .update(nodes)
    .set({
      chatCount: sql<number>`(select count(*) from ${sessionNodes} where ${sessionNodes.nodeId} = ${nodes.id})`,
    })
    .where(and(inArray(nodes.id, nodeIds), eq(nodes.workspaceId, workspaceId)))
  const removed = await tx
    .delete(nodes)
    .where(and(inArray(nodes.id, nodeIds), eq(nodes.chatCount, 0), eq(nodes.workspaceId, workspaceId)))
    .returning({ label: nodes.label })
  return removed.map((r) => r.label)
}

/** Phrases rejected account-wide, as canonical keys (spec §3.2). */
export async function rejectedKeys(tx: Tx, workspaceId: string): Promise<Set<string>> {
  const rows = await tx
    .select({ phrase: rejectedPhrases.phrase })
    .from(rejectedPhrases)
    .where(eq(rejectedPhrases.workspaceId, workspaceId))
  return new Set(rows.map((r) => canonicalKey(r.phrase)).filter(Boolean))
}

/**
 * Bring ONE chat's links in line with today's extractor over its stored user
 * messages: links it no longer yields are removed, links it now yields are
 * added (ticket 10, carrying ticket 12's Q4). Used by the re-extract
 * migration for every chat, and by deleteTurn after a turn is gone
 * (message-actions ticket 01) — concept links come only from message text,
 * so this is the whole rebuild.
 *
 * A concept forgotten in the chat is never linked (Q4). A phrase rejected
 * account-wide is never ADDED, and an existing link for it is left alone.
 * Existing links are not touched, so their last_referenced_at stays as it
 * was. A chat with no user messages loses every link. The headline is
 * re-derived by the Q13 rule.
 *
 * Returns every Node id it removed, added or kept: the caller recounts them
 * (kept links too — an old count can be wrong even where the link was right).
 */
export async function relinkChat(tx: Tx, workspaceId: string, sessionId: string, rejected: Set<string>): Promise<string[]> {
  const said = await tx
    .select({ id: messages.id, content: messages.content })
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), eq(messages.role, 'user')))
    .orderBy(messages.createdAt, messages.id)

  const skip = await forgottenKeys(tx, sessionId)
  const want = new Map<string, { label: string; messageIds: string[] }>()
  for (const m of said) {
    for (const label of extractConcepts(m.content).auto) {
      const key = canonicalKey(label)
      if (!key || skip.has(key)) continue
      const entry = want.get(key) ?? { label, messageIds: [] }
      entry.messageIds.push(m.id)
      want.set(key, entry)
    }
  }
  // Ingest links the headline even when only the TITLE yields it.
  const headline = said.length
    ? headlineCandidates(said[0].content).find((l) => {
        const k = canonicalKey(l)
        return k && !skip.has(k)
      })
    : undefined
  if (headline && !want.has(canonicalKey(headline))) want.set(canonicalKey(headline), { label: headline, messageIds: [] })

  const have = await tx
    .select({ id: nodes.id, key: nodes.canonicalKey })
    .from(sessionNodes)
    .innerJoin(nodes, eq(nodes.id, sessionNodes.nodeId))
    .where(eq(sessionNodes.sessionId, sessionId))
  const haveByKey = new Map(have.map((h) => [h.key, h.id]))
  const chatMessages = tx.select({ id: messages.id }).from(messages).where(eq(messages.sessionId, sessionId))
  const touched = new Set<string>()

  for (const h of have) {
    if (want.has(h.key)) continue
    await tx.delete(sessionNodes).where(and(eq(sessionNodes.sessionId, sessionId), eq(sessionNodes.nodeId, h.id)))
    await tx.delete(messageNodes).where(and(eq(messageNodes.nodeId, h.id), inArray(messageNodes.messageId, chatMessages)))
    touched.add(h.id)
  }

  for (const [key, entry] of want) {
    let nodeId = haveByKey.get(key) ?? null
    if (!nodeId) {
      if (rejected.has(key)) continue
      nodeId = await linkNode(tx, workspaceId, sessionId, entry.label)
      if (!nodeId) continue
      touched.add(nodeId)
    }
    for (const messageId of entry.messageIds) {
      await tx.insert(messageNodes).values({ messageId, nodeId }).onConflictDoNothing()
    }
  }

  for (const id of haveByKey.values()) touched.add(id)
  await rederiveHeadline(tx, workspaceId, sessionId)
  return [...touched]
}
