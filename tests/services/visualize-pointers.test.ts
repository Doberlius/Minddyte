import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb, chatPointers, messages, nodes } from '../../db'
import { FIXTURE_WORKSPACE_ID, newChat, truncateAll } from '../helpers/pglite'
import { ingestUserMessage, persistMessage } from '@/services/graph'
import { stripVisualize, blankVisualize } from '@/lib/scene/intent'
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
 * The fix: `ingestUserMessage` takes a separate `pointerContent`, built by
 * blanking the command to a same-length filler (see `blankVisualize`) rather
 * than removing it, so offsets built from it still land on the same
 * characters in the stored row.
 */
describe('a /visualize message keeps correct pointers into the stored text', () => {
  it('every pointer of the stored message matches the text at its own offset, and "visualize" is never a concept', async () => {
    const draft = '/visualize how a sine wave relates to the unit circle. Then show cosine too.'
    const memoryDraft = stripVisualize(draft)
    const pointerContent = blankVisualize(draft)

    const chatId = await newChat()
    const messageId = await persistMessage({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: chatId, role: 'user', content: draft,
    })

    await ingestUserMessage({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: chatId, messageId,
      content: memoryDraft,
      pointerContent,
    })

    const db = await getDb()
    const [stored] = await db.select({ content: messages.content }).from(messages).where(eq(messages.id, messageId))
    expect(stored.content).toBe(draft)

    const rows = await db.select().from(chatPointers).where(eq(chatPointers.messageId, messageId))
    expect(rows.length).toBeGreaterThan(0)

    // Pointers must be built from text whose offsets match the STORED row
    // (retrieval.ts and forget.ts both read the real quote back with
    // `Array.from(stored).slice(startChar, endChar)`). `matchText` is only
    // ever a search index (schema.ts: "if it ever drifted, the failure would
    // be a missed match, never a wrong quote") built from the blanked
    // pointer-content, so it is compared against the SAME blanking applied
    // to the stored row — proving the offsets this test's `matchText` came
    // from are the same offsets that correctly address `stored`.
    const blankedStoredChars = Array.from(blankVisualize(stored.content))
    for (const row of rows) {
      const blankedSlice = blankedStoredChars.slice(row.startChar, row.endChar).join('')
      expect(blankedSlice).toBe(row.matchText)
    }

    // And the offsets must correctly address the REAL stored text, not a
    // shifted position: the second sentence — entirely outside the blanked
    // command — must be found at its pointer's offsets verbatim, and the
    // first sentence's real text (after the command) must be there too.
    const storedChars = Array.from(stored.content)
    const second = rows.find((r) => storedChars.slice(r.startChar, r.endChar).join('').includes('Then show cosine too.'))
    expect(second).toBeDefined()
    expect(storedChars.slice(second!.startChar, second!.endChar).join('')).toBe('Then show cosine too.')

    const first = rows.find((r) => storedChars.slice(r.startChar, r.endChar).join('').includes('how a sine wave'))
    expect(first).toBeDefined()
    expect(storedChars.slice(first!.startChar, first!.endChar).join('')).toContain(
      'how a sine wave relates to the unit circle.',
    )

    // "visualize" must never surface as a concept Node from a command word.
    const [visualizeNode] = await db
      .select()
      .from(nodes)
      .where(eq(nodes.canonicalKey, canonicalKey('visualize')))
    expect(visualizeNode).toBeUndefined()
  })
})
