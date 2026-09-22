import { beforeEach, describe, expect, it } from 'vitest'
import { truncateAll } from '../helpers/pglite'
import { createChat, listChats, renameChat, loadChat } from '@/services/dbApi'
import { persistMessage, ingestUserMessage } from '@/services/graph'

beforeEach(truncateAll)

/**
 * Renaming a chat.
 *
 * The title is normally derived once, from the first message, and never
 * recomputed — `deriveTitle` caps it at 60 characters and can land mid-clause.
 * Renaming is the user's override of that, so the one thing it must not do is
 * re-derive, and the one thing it must not touch is the graph: the Headline is
 * a Node taken from the ORIGINAL title, and a rename is a label change, not a
 * new concept.
 */

async function say(sessionId: string, content: string) {
  const messageId = await persistMessage({ sessionId, role: 'user', content })
  await ingestUserMessage({ sessionId, messageId, content })
}

async function titleOf(id: string): Promise<string | undefined> {
  return (await loadChat(id))?.title
}

describe('renameChat', () => {
  it('sets the title', async () => {
    const { id } = await createChat()

    await renameChat(id, 'Ledger design notes')

    expect(await titleOf(id)).toBe('Ledger design notes')
  })

  it('reports whether there was a chat to rename', async () => {
    const { id } = await createChat()

    expect(await renameChat(id, 'Kept')).toBe(true)
    expect(await renameChat('00000000-0000-0000-0000-000000000000', 'Nope')).toBe(false)
  })

  it('trims the surrounding whitespace someone pasted in', async () => {
    const { id } = await createChat()

    await renameChat(id, '   Ledger design notes\n')

    expect(await titleOf(id)).toBe('Ledger design notes')
  })

  it('refuses a name that is only whitespace', async () => {
    const { id } = await createChat()
    await renameChat(id, 'Real name')

    expect(await renameChat(id, '    ')).toBe(false)
    // The old name survives: a blank rename is a mistake, not an instruction
    // to leave the row unlabelled.
    expect(await titleOf(id)).toBe('Real name')
  })

  it('caps a very long name rather than storing it whole', async () => {
    const { id } = await createChat()

    await renameChat(id, 'x'.repeat(400))

    const title = await titleOf(id)
    expect(title!.length).toBeLessThanOrEqual(120)
  })

  it('does not touch the concepts or the memory', async () => {
    // A rename changes a label. The Headline was taken from the first
    // message's own words and stays what it was.
    const { id } = await createChat()
    await say(id, 'We run PostgreSQL in production.')
    const before = await loadChat(id)

    await renameChat(id, 'Something else entirely')
    const after = await loadChat(id)

    expect(after!.compaction).toBe(before!.compaction)
    expect(after!.headlineNodeId).toBe(before!.headlineNodeId)
  })

  it('shows the new name in the list', async () => {
    const { id } = await createChat()

    await renameChat(id, 'Ledger design notes')

    expect((await listChats()).map((c) => c.title)).toContain('Ledger design notes')
  })

  it('does not re-derive the title on the next message', async () => {
    // deriveTitle runs once, on the FIRST user message. A chat renamed after
    // that must keep the name through everything said afterwards.
    const { id } = await createChat()
    await say(id, 'We run PostgreSQL in production.')
    await renameChat(id, 'Ledger design notes')

    await say(id, 'Kubernetes schedules it anyway.')

    expect(await titleOf(id)).toBe('Ledger design notes')
  })
})
