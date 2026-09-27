import { and, eq } from 'drizzle-orm'
import { getDb, messages, sessions } from '../../db'
import { findSceneBlocks, isSingleSceneBody, replaceSceneBlock } from '@/lib/scene/blocks'
import { rewritePointers } from './graph'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type SceneTarget = { workspaceId: string; sessionId: string; messageId: string; blockIndex: number }

/** The reply's text, only if it is an assistant message in the caller's own chat. */
async function ownReply(t: SceneTarget): Promise<string | null> {
  if (!UUID.test(t.sessionId) || !UUID.test(t.messageId)) return null
  const db = await getDb()
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
  const content = await ownReply(t)
  return content === null ? null : (findSceneBlocks(content)[t.blockIndex]?.code ?? null)
}

/**
 * Save a repair that ran successfully: replace exactly that block, and rebuild
 * the message's pointers in the same transaction (Decision 4).
 */
export async function saveSceneBlock(t: SceneTarget & { code: string }): Promise<boolean> {
  if (!isSingleSceneBody(t.code)) return false
  const content = await ownReply(t)
  if (content === null) return false
  const next = replaceSceneBlock(content, t.blockIndex, t.code)
  if (next === null) return false
  const db = await getDb()
  await db.transaction(async (tx) => {
    await tx.update(messages).set({ content: next }).where(eq(messages.id, t.messageId))
    await rewritePointers(tx, { workspaceId: t.workspaceId, sessionId: t.sessionId, messageId: t.messageId, content: next })
  })
  return true
}
