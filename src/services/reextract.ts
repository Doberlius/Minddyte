import { and, eq, inArray } from 'drizzle-orm'
import { messageNodes, messages, nodes, rejectedPhrases, sessionNodes, sessions } from '../../db/schema'
import { extractConcepts } from '../lib/extract'
import { canonicalKey } from '../lib/text'
import { forgottenKeys, headlineCandidates, linkNode, recountNodes, rederiveHeadline, type Tx } from './links'

/**
 * Re-run today's extractor over every stored USER message and bring each
 * chat's links in line with it (ticket 10, carrying ticket 12's Q4).
 *
 * Extraction fixes (ticket 11's comma split, ticket 12's leading verb) change
 * what a message yields, but a database that already ran keeps the old,
 * dead keys. messages.content is the source of truth, so this is
 * deterministic, like 0001_backfill_chat_pointers. Each future extraction
 * fix appends one more step that calls this.
 *
 * Per chat: links the extractor no longer yields are removed; links it now
 * yields are added. A concept forgotten in the chat is never linked (Q4). A
 * phrase rejected account-wide is never ADDED, and an existing link for it is
 * left alone: removing those is the review screen's job, not a migration's.
 * Existing links are not touched, so their last_referenced_at stays as it was.
 * Every headline is re-derived by the Q13 rule, which gives the same answer as
 * before for any chat the fixes did not change. Every concept it deletes is
 * logged: never destroy silently.
 */
export async function reextractNodes(tx: Tx): Promise<void> {
  const chats = await tx
    .select({ id: sessions.id, workspaceId: sessions.workspaceId })
    .from(sessions)
    .orderBy(sessions.createdAt, sessions.id)

  const touched = new Map<string, Set<string>>()
  const touch = (workspaceId: string, nodeId: string) => {
    const set = touched.get(workspaceId) ?? new Set<string>()
    set.add(nodeId)
    touched.set(workspaceId, set)
  }
  const rejectedByWorkspace = new Map<string, Set<string>>()

  for (const chat of chats) {
    const said = await tx
      .select({ id: messages.id, content: messages.content })
      .from(messages)
      .where(and(eq(messages.sessionId, chat.id), eq(messages.role, 'user')))
      .orderBy(messages.createdAt, messages.id)
    if (said.length === 0) continue

    const skip = await forgottenKeys(tx, chat.id)
    let rejected = rejectedByWorkspace.get(chat.workspaceId)
    if (!rejected) {
      const rows = await tx
        .select({ phrase: rejectedPhrases.phrase })
        .from(rejectedPhrases)
        .where(eq(rejectedPhrases.workspaceId, chat.workspaceId))
      rejected = new Set(rows.map((r) => canonicalKey(r.phrase)).filter(Boolean))
      rejectedByWorkspace.set(chat.workspaceId, rejected)
    }

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
    const headline = headlineCandidates(said[0].content).find((l) => {
      const k = canonicalKey(l)
      return k && !skip.has(k)
    })
    if (headline && !want.has(canonicalKey(headline))) want.set(canonicalKey(headline), { label: headline, messageIds: [] })

    const have = await tx
      .select({ id: nodes.id, key: nodes.canonicalKey })
      .from(sessionNodes)
      .innerJoin(nodes, eq(nodes.id, sessionNodes.nodeId))
      .where(eq(sessionNodes.sessionId, chat.id))
    const haveByKey = new Map(have.map((h) => [h.key, h.id]))
    const chatMessages = tx.select({ id: messages.id }).from(messages).where(eq(messages.sessionId, chat.id))

    for (const h of have) {
      if (want.has(h.key)) continue
      await tx.delete(sessionNodes).where(and(eq(sessionNodes.sessionId, chat.id), eq(sessionNodes.nodeId, h.id)))
      await tx.delete(messageNodes).where(and(eq(messageNodes.nodeId, h.id), inArray(messageNodes.messageId, chatMessages)))
      touch(chat.workspaceId, h.id)
    }

    for (const [key, entry] of want) {
      let nodeId = haveByKey.get(key) ?? null
      if (!nodeId) {
        if (rejected.has(key)) continue
        nodeId = await linkNode(tx, chat.workspaceId, chat.id, entry.label)
        if (!nodeId) continue
        touch(chat.workspaceId, nodeId)
      }
      for (const messageId of entry.messageIds) {
        await tx.insert(messageNodes).values({ messageId, nodeId }).onConflictDoNothing()
      }
    }

    // Kept links are recounted too: an old count can be wrong even where the
    // link itself was right (the recount test pins this).
    for (const id of haveByKey.values()) touch(chat.workspaceId, id)

    await rederiveHeadline(tx, chat.workspaceId, chat.id)
  }

  for (const [workspaceId, ids] of touched) {
    for (const label of await recountNodes(tx, workspaceId, [...ids])) {
      console.warn(`[migrate] removed the concept "${label}": no chat holds it any more`)
    }
  }
}
