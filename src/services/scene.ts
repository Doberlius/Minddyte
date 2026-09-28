import { and, eq } from 'drizzle-orm'
import { getDb, messages, sessions, type Db } from '../../db'
import { findSceneBlocks, isSingleSceneBody, replaceSceneBlock } from '@/lib/scene/blocks'
import { rewritePointers } from './graph'
import type { Tx } from './links'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type SceneTarget = { workspaceId: string; sessionId: string; messageId: string; blockIndex: number }

/** The reply's text, only if it is an assistant message in the caller's own chat. */
async function ownReply(db: Db | Tx, t: SceneTarget): Promise<string | null> {
  if (!UUID.test(t.sessionId) || !UUID.test(t.messageId)) return null
  const [row] = await db
    .select({ content: messages.content })
    .from(messages)
    .innerJoin(sessions, eq(sessions.id, messages.sessionId))
    .where(and(
      eq(messages.id, t.messageId),
      eq(messages.sessionId, t.sessionId),
      eq(sessions.workspaceId, t.workspaceId),
      eq(messages.role, 'assistant'),
    ))
  return row?.content ?? null
}

/** Spec §8: the failing code comes from the database, never from the request. */
export async function loadSceneBlock(t: SceneTarget): Promise<string | null> {
  const db = await getDb()
  const content = await ownReply(db, t)
  return content === null ? null : (findSceneBlocks(content)[t.blockIndex]?.code ?? null)
}

/**
 * Save a repair that ran successfully: replace exactly that block, and rebuild
 * the message's pointers in the same transaction (Decision 4).
 *
 * The read of `ownReply` happens INSIDE this same transaction, via `tx`, not
 * before it starts. Read-then-write outside a transaction is a check-then-act
 * race: two concurrent repairs of DIFFERENT blocks in the same reply could
 * both read the pre-repair content, each compute a `next` from that same
 * stale base, and whichever write lands second would silently overwrite the
 * first repair. `db/index.ts` documents this database as single-connection by
 * architecture, so PGlite has no second backend to interleave a second
 * transaction's statements with this one's — reading on `tx` puts the read
 * inside this transaction's turn, and the next `saveSceneBlock` call cannot
 * run its own read until this one has committed (or failed) and released the
 * connection.
 */
export async function saveSceneBlock(t: SceneTarget & { code: string }): Promise<boolean> {
  if (!isSingleSceneBody(t.code)) return false
  const db = await getDb()
  return db.transaction(async (tx) => {
    const content = await ownReply(tx, t)
    if (content === null) return false
    const next = replaceSceneBlock(content, t.blockIndex, t.code)
    if (next === null) return false
    await tx.update(messages).set({ content: next }).where(eq(messages.id, t.messageId))
    await rewritePointers(tx, { workspaceId: t.workspaceId, sessionId: t.sessionId, messageId: t.messageId, content: next })
    return true
  })
}
