import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb, chatPointers, messages, nodes } from '../../db'
import { FIXTURE_WORKSPACE_ID, newChat, truncateAll } from '../helpers/pglite'
import { ingestUserMessage, persistMessage } from '@/services/graph'
import { stripVisualize, visualizePrefixLength } from '@/lib/scene/intent'
import { canonicalKey } from '@/lib/text'

beforeEach(truncateAll)

/**
 * Regression for the CRITICAL finding: route.ts persists the STORED user
 * message verbatim (with the leading `/visualize` command still in it), but
 * pointers are offsets read back from that stored row at retrieval time
 * (retrieval.ts, forget.ts both `substring()` into `messages.content`).
 * Building pointers from the command-STRIPPED text — shorter than what was
 * actually stored — shifted every single offset for a `/visualize` message.
 *
 * The fix: `ingestUserMessage` takes `pointerShift`, a code-point count added
 * to every offset built from `content` (`memoryDraft`, the already-stripped
 * text — so `match_text` stays clean and extraction never sees "visualize"
 * as a concept). The shift is `visualizePrefixLength(draft)`, the length of
 * exactly what `stripVisualize` removed, which moves pointers built from the
 * shorter text back onto the same characters in the longer stored row.
 */
describe('a /visualize message keeps correct pointers into the stored text', () => {
  it('every pointer of the stored message matches the text at its own offset, and "visualize" is never a concept', async () => {
    const draft = '/visualize how a sine wave relates to the unit circle. Then show cosine too.'
    const memoryDraft = stripVisualize(draft)

    const chatId = await newChat()
    const messageId = await persistMessage({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: chatId, role: 'user', content: draft,
    })

    await ingestUserMessage({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: chatId, messageId,
      content: memoryDraft,
      pointerShift: visualizePrefixLength(draft),
    })

    const db = await getDb()
    const [stored] = await db.select({ content: messages.content }).from(messages).where(eq(messages.id, messageId))
    expect(stored.content).toBe(draft)

    const rows = await db.select().from(chatPointers).where(eq(chatPointers.messageId, messageId))
    expect(rows.length).toBeGreaterThan(0)

    // The ORIGINAL requirement, taken literally: every pointer's offsets,
    // read back from the STORED (unstripped) text, reproduce `matchText`
    // exactly. `matchText` is `memoryDraft`'s own sentence — never the
    // command — so the first pointer must start AFTER "/visualize " in the
    // stored text, not at its beginning.
    const storedChars = Array.from(stored.content)
    for (const row of rows) {
      const slice = storedChars.slice(row.startChar, row.endChar).join('')
      expect(slice).toBe(row.matchText)
    }

    const first = rows.find((r) => r.matchText.includes('how a sine wave'))
    expect(first).toBeDefined()
    expect(first!.matchText).toBe('how a sine wave relates to the unit circle.')
    expect(first!.startChar).toBe(visualizePrefixLength(draft))

    const second = rows.find((r) => r.matchText.includes('Then show cosine too.'))
    expect(second).toBeDefined()
    expect(second!.matchText).toBe('Then show cosine too.')

    // No pointer's matchText (or stored slice) ever contains the command
    // word itself.
    for (const row of rows) {
      expect(row.matchText).not.toMatch(/visualize/i)
    }

    // "visualize" must never surface as a concept Node from a command word.
    const [visualizeNode] = await db
      .select()
      .from(nodes)
      .where(eq(nodes.canonicalKey, canonicalKey('visualize')))
    expect(visualizeNode).toBeUndefined()
  })

  it('a bare "/visualize" (nothing left after stripping) writes zero pointer rows', async () => {
    const draft = '/visualize'
    const memoryDraft = stripVisualize(draft)
    expect(memoryDraft).toBe('')

    const chatId = await newChat()
    const messageId = await persistMessage({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: chatId, role: 'user', content: draft,
    })

    await ingestUserMessage({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: chatId, messageId,
      content: memoryDraft,
      pointerShift: visualizePrefixLength(draft),
    })

    const db = await getDb()
    const rows = await db.select().from(chatPointers).where(eq(chatPointers.messageId, messageId))
    expect(rows).toHaveLength(0)

    const [visualizeNode] = await db
      .select()
      .from(nodes)
      .where(eq(nodes.canonicalKey, canonicalKey('visualize')))
    expect(visualizeNode).toBeUndefined()
  })
})
