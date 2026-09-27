import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb, chatPointers, messages } from '../../db'
import { FIXTURE_WORKSPACE_ID as WS, newChat, truncateAll } from '../helpers/pglite'
import { ingestUserMessage, persistMessage } from '@/services/graph'
import { loadSceneBlock, saveSceneBlock } from '@/services/scene'
import { newWorkspaceId } from '@/lib/workspace'

beforeEach(truncateAll)

const REPLY = 'Look.\n\n```scene\nplay(create(sphere()))\n```\n\nThe curve rises. Then it falls.\n\n```scene\nplay(create(axes()))\n```\n\nEnd of story.'

async function seed() {
  const chat = await newChat('A')
  const userId = await persistMessage({ workspaceId: WS, sessionId: chat, role: 'user', content: '/visualize a curve' })
  const replyId = await persistMessage({ workspaceId: WS, sessionId: chat, role: 'assistant', content: REPLY })
  await ingestUserMessage({ workspaceId: WS, sessionId: chat, messageId: userId, content: 'a curve', assistantContent: REPLY, assistantMessageId: replyId })
  return { chat, userId, replyId }
}

describe('loadSceneBlock', () => {
  it("reads a block of the caller's own reply", async () => {
    const { chat, replyId } = await seed()
    expect(await loadSceneBlock({ workspaceId: WS, sessionId: chat, messageId: replyId, blockIndex: 0 })).toBe('play(create(sphere()))')
    expect(await loadSceneBlock({ workspaceId: WS, sessionId: chat, messageId: replyId, blockIndex: 1 })).toBe('play(create(axes()))')
  })

  it('refuses another workspace, a user message, a missing block and a bad id', async () => {
    const { chat, userId, replyId } = await seed()
    expect(await loadSceneBlock({ workspaceId: newWorkspaceId(), sessionId: chat, messageId: replyId, blockIndex: 0 })).toBeNull()
    expect(await loadSceneBlock({ workspaceId: WS, sessionId: chat, messageId: userId, blockIndex: 0 })).toBeNull()
    expect(await loadSceneBlock({ workspaceId: WS, sessionId: chat, messageId: replyId, blockIndex: 2 })).toBeNull()
    expect(await loadSceneBlock({ workspaceId: WS, sessionId: chat, messageId: 'nope', blockIndex: 0 })).toBeNull()
  })
})

describe('saveSceneBlock', () => {
  it('replaces exactly one block and keeps every pointer reading its own text', async () => {
    const { chat, replyId } = await seed()
    const fixed = 'const ax = axes()\nplay(create(ax))\nplay(create(ax.plot(x => x * x)))'
    expect(await saveSceneBlock({ workspaceId: WS, sessionId: chat, messageId: replyId, blockIndex: 0, code: fixed })).toBe(true)

    const db = await getDb()
    const [row] = await db.select({ content: messages.content }).from(messages).where(eq(messages.id, replyId))
    expect(row.content).toContain('```scene\n' + fixed + '\n```')
    expect(row.content).toContain('```scene\nplay(create(axes()))\n```')
    expect(row.content.endsWith('End of story.')).toBe(true)

    const pointers = await db.select().from(chatPointers).where(eq(chatPointers.messageId, replyId))
    const cps = Array.from(row.content)
    expect(pointers.length).toBeGreaterThan(0)
    for (const p of pointers) expect(cps.slice(p.startChar, p.endChar).join('')).toBe(p.matchText)
    expect(pointers.map((p) => p.matchText)).toContain('End of story.')
    expect(pointers.some((p) => p.matchText.includes('scene'))).toBe(false)
  })

  it("refuses another workspace's message and a missing block", async () => {
    const { chat, replyId } = await seed()
    expect(await saveSceneBlock({ workspaceId: newWorkspaceId(), sessionId: chat, messageId: replyId, blockIndex: 0, code: 'x()' })).toBe(false)
    expect(await saveSceneBlock({ workspaceId: WS, sessionId: chat, messageId: replyId, blockIndex: 3, code: 'x()' })).toBe(false)
  })
})
