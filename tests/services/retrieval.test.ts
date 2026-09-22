import { beforeEach, describe, expect, it } from 'vitest'
import { FIXTURE_WORKSPACE_ID, newChat, truncateAll } from '../helpers/pglite'
import { persistMessage, ingestUserMessage } from '@/services/graph'
import { retrieveContext } from '@/services/retrieval'
import { AUTO_REACH_CAP } from '@/lib/rank'

const SHARED = 'Kafka partitions handle event ordering in distributed systems.'
const DRAFT = 'How do Kafka partitions affect throughput?'
const UNRELATED = 'Sourdough starter needs feeding twice a day.'

/** Build a chat that has really been ingested, so it owns real Nodes. */
async function ingestedChat(text: string, reply = 'A reply.'): Promise<string> {
  const chatId = await newChat()
  const messageId = await persistMessage({
    workspaceId: FIXTURE_WORKSPACE_ID, sessionId: chatId, role: 'user', content: text,
  })
  await ingestUserMessage({
    workspaceId: FIXTURE_WORKSPACE_ID, sessionId: chatId, messageId, content: text, assistantContent: reply,
  })
  return chatId
}

beforeEach(truncateAll)

describe('retrieval against a real database', () => {
  it('every query executes and explore reaches a chat sharing a Node', async () => {
    const other = await ingestedChat(SHARED)
    const current = await ingestedChat(SHARED)

    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: current, mode: 'explore', taggedChatIds: [], draftText: DRAFT,
    })

    expect(chats.map((c) => c.id)).toContain(other)
    expect(chats.every((c) => c.id !== current)).toBe(true)
  })

  it('focus reaches nothing automatic', async () => {
    // Spec §6.1. The skip is the CALL, not an empty key list — the match set
    // includes the current Chat's own Nodes, so passing no draft keys would
    // still reach, which is exactly what focus forbids.
    await ingestedChat(SHARED)
    const current = await ingestedChat(SHARED)

    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: current, mode: 'focus', taggedChatIds: [], draftText: DRAFT,
    })

    expect(chats).toHaveLength(0)
  })

  it('focus still returns what the user explicitly tagged', async () => {
    const tagged = await ingestedChat(UNRELATED)
    const current = await ingestedChat(SHARED)

    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: current, mode: 'focus', taggedChatIds: [tagged], draftText: DRAFT,
    })

    expect(chats.map((c) => c.id)).toEqual([tagged])
    // No shared Nodes, so the reason is bare.
    expect(chats[0].why).toBe('tagged')
  })

  it('caps automatic reaches, and the cap does not apply to tagged chats', async () => {
    // Spec §6.2 — a QUALITY limit on automatic reach, not a capacity one.
    const overlapping: string[] = []
    for (let i = 0; i < AUTO_REACH_CAP + 2; i++) overlapping.push(await ingestedChat(SHARED))
    const current = await ingestedChat(SHARED)

    const auto = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: current, mode: 'explore', taggedChatIds: [], draftText: DRAFT,
    })
    expect(auto.chats).toHaveLength(AUTO_REACH_CAP)

    const withTags = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: current, mode: 'explore', taggedChatIds: overlapping, draftText: DRAFT,
    })
    // All of them are tagged, so all of them come back — uncapped.
    expect(withTags.chats).toHaveLength(overlapping.length)
  })

  it('a chat that is both tagged and overlapping appears exactly once', async () => {
    const both = await ingestedChat(SHARED)
    const current = await ingestedChat(SHARED)

    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: current, mode: 'explore', taggedChatIds: [both], draftText: DRAFT,
    })

    expect(chats.filter((c) => c.id === both)).toHaveLength(1)
    // Tagged wins, and the reason names the shared concept it also has.
    expect(chats[0].why.startsWith('tagged')).toBe(true)
  })

  it('tagged chats are ordered before automatic reaches', async () => {
    const tagged = await ingestedChat(UNRELATED)
    const overlap = await ingestedChat(SHARED)
    const current = await ingestedChat(SHARED)

    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: current, mode: 'explore', taggedChatIds: [tagged], draftText: DRAFT,
    })

    expect(chats[0].id).toBe(tagged)
    expect(chats.map((c) => c.id)).toContain(overlap)
  })

  it('an unrelated chat is not reached', async () => {
    await ingestedChat(UNRELATED)
    const current = await ingestedChat(SHARED)

    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: current, mode: 'explore', taggedChatIds: [], draftText: DRAFT,
    })

    expect(chats).toHaveLength(0)
  })
})
