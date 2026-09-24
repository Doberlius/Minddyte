import { beforeEach, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { getDb, sessions, messages } from '../../db'
import { strongPhrases } from '@/lib/tokens'
import { FIXTURE_WORKSPACE_ID, newChat, truncateAll } from '../helpers/pglite'
import { ingestUserMessage, persistMessage } from '@/services/graph'
import { retrieveContext, scoredPointers } from '@/services/retrieval'
import { PROVISIONAL } from '@/lib/provisional'
import { sentLength } from '@/lib/prompt'

beforeEach(truncateAll)

/** One full turn, both roles indexed. Shared by every describe in this file. */
async function turn(chatId: string, user: string, assistant: string) {
  const workspaceId = FIXTURE_WORKSPACE_ID
  const messageId = await persistMessage({ workspaceId, sessionId: chatId, role: 'user', content: user })
  const assistantMessageId = await persistMessage({ workspaceId, sessionId: chatId, role: 'assistant', content: assistant, modelUsed: 'test' })
  await ingestUserMessage({ workspaceId, sessionId: chatId, messageId, content: user, assistantContent: assistant, assistantMessageId })
}

describe('retrieval reads memory from pointers', () => {
  // The failure ticket 11 measured: the fact lives deep in a long reply.
  it('reaches a fact from deep inside a long reply', async () => {
    const a = await newChat('A')
    const filler = Array.from({ length: 40 }, (_, i) => `Filler sentence number ${i} says little.`).join(' ')
    await turn(a, 'Tell me about Kafka partitions.', `${filler} Kafka partitions guarantee order only within one partition.`)
    const b = await newChat('B')
    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'explore', taggedChatIds: [],
      draftText: 'How do Kafka partitions guarantee order?',
    })
    expect(chats.map((c) => c.id)).toEqual([a])
    expect(chats[0].excerpts.map((e) => e.text).join(' ')).toContain('guarantee order only within one partition')
  })

  // Whole-branch review, finding 6 (spec Q10): each chat's passages are scored
  // against the draft and the labels of the Nodes IT shares — not a label set
  // pooled from every reached chat, which would let chat C's concept pick
  // chat A's passages.
  it("scores a chat's passages by its own shared concepts, not another chat's", async () => {
    const a = await newChat('A')
    const filler = Array.from({ length: 12 }, (_, i) => `Filler sentence number ${i} says little.`).join(' ')
    await turn(a, 'Tell me about Kafka partitions.', `Kafka partitions keep order. ${filler} Redis caching belongs to another chat entirely.`)
    const c = await newChat('C')
    await turn(c, 'Tell me about Redis caching.', 'Redis caching keeps hot keys in memory.')
    const b = await newChat('B')
    await turn(b, 'How do Kafka partitions relate to Redis caching?', 'Sure.')
    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'explore', taggedChatIds: [], draftText: 'go on',
    })
    const found = chats.find((x) => x.id === a)!
    expect(found.why).toMatch(/Kafka partitions/i)
    expect(found.why).not.toMatch(/Redis caching/i)
    expect(found.excerpts.map((e) => e.text).join(' ')).toContain('Kafka partitions keep order.')
    expect(found.excerpts.map((e) => e.text).join(' ')).not.toContain('Redis caching belongs to another chat')
  })

  it('sends the text that follows an emoji verbatim', async () => {
    const a = await newChat('A')
    await turn(a, '🎉 Kafka partitions keep order. Redis caches sessions.', 'Noted.')
    const b = await newChat('B')
    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'focus', taggedChatIds: [a], draftText: 'what about Redis?',
    })
    expect(chats[0].excerpts.map((e) => e.text).join('\n')).toContain('Redis caches sessions.')
  })

  // Review Focus 5.
  // Each assistant excerpt is ~3 passages x ~1,050 chars, so four chats need
  // ~12,600 chars against an 8,000 budget: at least one must lose a window.
  it('reports every tagged chat that did not fully fit, instead of shrinking it silently', async () => {
    const ids: string[] = []
    for (let i = 0; i < 4; i++) {
      const id = await newChat(`Big ${i}`)
      const long = Array.from({ length: 12 }, (_, j) => `Chat ${i} passage ${j} ${'detail '.repeat(150)}end.`).join(' ')
      await turn(id, `Long chat ${i}.`, long)
      ids.push(id)
    }
    const b = await newChat('B')
    const { chats, dropped } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'focus', taggedChatIds: ids, draftText: 'summarise',
    })
    const used = chats.reduce((n, c) => n + c.excerpts.reduce((m, e) => m + sentLength(e), 0), 0)
    expect(used).toBeLessThanOrEqual(8000)
    expect(dropped.length).toBeGreaterThan(0)
    // Every chat is accounted for: fully sent, or named in `dropped`.
    const full = chats.filter((c) => !dropped.includes(c.title))
    expect(full.length + dropped.length).toBe(4)
  })
})

describe('reach by text', () => {
  // The case node overlap cannot reach: the fact is in the ASSISTANT reply,
  // extraction is user-only (§4.2), so no Node is attached to it.
  it('reaches a chat whose only relevant content is an assistant fact', async () => {
    const a = await newChat('Logs')
    await turn(a, 'What are the defaults?', 'The retention period for audit logs is ninety days by default.')
    const b = await newChat('B')
    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'explore', taggedChatIds: [],
      draftText: 'how long do we keep audit logs',
    })
    expect(chats.map((c) => c.id)).toContain(a)
  })

  it('promotes an exact multi-word phrase, and says so', async () => {
    const a = await newChat('Logs')
    await turn(a, 'Defaults?', 'The retention period for audit logs is ninety days by default.')
    const b = await newChat('B')
    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'explore', taggedChatIds: [],
      draftText: 'What is our retention period?',
    })
    expect(chats[0].id).toBe(a)
    expect(chats[0].why).toMatch(/matches exact phrase "retention period"/i)
  })

  // Fix round 1, finding 2: every other test in this file reaches through a
  // strong phrase, so 'text' — the plain, unpromoted tier — and its "matches
  // your wording" reason were never exercised. Measured against this exact
  // fixture: word_similarity('ninety days sounds about right', 'The
  // retention period for audit logs is ninety days by default.') = 0.387,
  // above PROVISIONAL.reachWordSimilarity (0.3); strongPhrases('ninety days
  // sounds about right') = [] (no phrase of >= 2 significant tokens), so
  // promotion never fires and the chat surfaces via the plain text tier.
  it('reaches a chat by wording alone, with no strong phrase to promote it', async () => {
    const a = await newChat('Logs')
    await turn(a, 'What are the defaults?', 'The retention period for audit logs is ninety days by default.')
    expect(strongPhrases('ninety days sounds about right')).toEqual([])
    const b = await newChat('B')
    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'explore', taggedChatIds: [],
      draftText: 'ninety days sounds about right',
    })
    expect(chats.map((c) => c.id)).toContain(a)
    const found = chats.find((c) => c.id === a)!
    expect(found.why).toMatch(/matches your wording/i)
  })

  it('does not reach by text in focus mode', async () => {
    const a = await newChat('Logs')
    await turn(a, 'Defaults?', 'The retention period for audit logs is ninety days by default.')
    const b = await newChat('B')
    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'focus', taggedChatIds: [], draftText: 'retention period',
    })
    expect(chats).toEqual([])
  })

  // Review Focus 3: a leaked GUC is permanent on single-connection PGlite.
  it('leaves the trigram thresholds at their defaults afterwards', async () => {
    const b = await newChat('B')
    await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'explore', taggedChatIds: [], draftText: 'anything at all',
    })
    const db = await getDb()
    const res = await db.execute(sql`show pg_trgm.word_similarity_threshold`)
    const value = Object.values((res as unknown as { rows: Record<string, string>[] }).rows[0])[0]
    expect(value).toBe('0.6')
    const strictRes = await db.execute(sql`show pg_trgm.strict_word_similarity_threshold`)
    const strictValue = Object.values((strictRes as unknown as { rows: Record<string, string>[] }).rows[0])[0]
    expect(strictValue).toBe('0.5')
  })
})

// Whole-branch review, finding 1: pg_trgm rebuilds the draft's trigrams for
// every candidate row, and a long draft shares trigrams with nearly every
// passage, so the index narrows little and the cost grows with draft length.
// PGlite is one in-process connection: while this runs, every visitor waits.
// The chat route has seen a real 824,000-char paste.
describe('a very long draft', () => {
  const TOPICS = [
    'Kafka partitions keep order within one partition and consumers commit offsets after processing.',
    'Redis caches session tokens with a short expiry so a restart only logs people out.',
    'PostgreSQL vacuum reclaims dead tuples and the autovacuum daemon tunes itself by table size.',
    'The retention period for audit logs is ninety days unless the contract says otherwise.',
    'Password hashing uses argon2id with a memory cost chosen to take about half a second.',
    'The deploy pipeline builds a container, runs migrations, then shifts traffic gradually.',
    'Feature flags are evaluated on the server so the client never sees an unreleased path.',
    'Rate limiting counts requests per workspace in a sliding window of sixty seconds.',
  ]
  const WORDS = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu'.split(' ')

  function varied(seed: number, n: number): string {
    return Array.from({ length: n }, (_, i) => {
      const t = TOPICS[(seed + i) % TOPICS.length]
      return `${t} Note ${WORDS[(seed * 7 + i) % WORDS.length]} ${WORDS[(seed + i * 3) % WORDS.length]} ${seed}-${i}.`
    }).join(' ')
  }

  it('costs no more than a short one: the search reads a bounded prefix', async () => {
    for (let c = 0; c < 40; c++) {
      const id = await newChat(`Seed ${c}`)
      await turn(id, `Question ${c} about ${TOPICS[c % TOPICS.length].split(' ').slice(0, 3).join(' ')}?`, varied(c, 8))
    }
    const b = await newChat('B')
    let draft = ''
    for (let i = 0; draft.length < 50_000; i++) draft += varied(i + 100, 1) + ' '
    draft = draft.slice(0, 50_000)

    const started = performance.now()
    await retrieveContext({ workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'explore', taggedChatIds: [], draftText: draft })
    // Measured at this scale: uncapped 9,944 ms; capped at 500 code points 450 ms.
    expect(performance.now() - started).toBeLessThan(1500)
  }, 120_000)
})

describe('a huge tagged chat', () => {
  it('answers in well under a second, and still finds the fact', async () => {
    const big = await newChat('Big')
    const filler = Array.from({ length: 3000 }, (_, i) => `Filler line ${i} mentions nothing useful at all.`).join(' ')
    await turn(big, 'Here is a long log.', `${filler} The retention period for audit logs is ninety days.`)
    const b = await newChat('B')
    const t = performance.now()
    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'focus', taggedChatIds: [big],
      draftText: 'what is the retention period for audit logs',
    })
    expect(performance.now() - t).toBeLessThan(1500)
    expect(chats[0].excerpts.map((e) => e.text).join(' ')).toContain('ninety days')
  })

  // Fix round 1, finding 2: the timing assertion above passed even on the OLD
  // code (1.3 s, under the 1.5 s bound) on a fast machine with this fixture's
  // size — it guards nothing by itself. This is the structural guarantee the
  // fix actually makes: scoredPointers reads back text for the picked
  // passages and their neighbours ONLY, never every passage of the chat.
  it('reads back only the picked passages and their neighbours, never every passage', async () => {
    const big = await newChat('Big')
    const filler = Array.from({ length: 3000 }, (_, i) => `Filler line ${i} mentions nothing useful at all.`).join(' ')
    await turn(big, 'Here is a long log.', `${filler} The retention period for audit logs is ninety days.`)
    const picks = PROVISIONAL.windowsPerChat
    const pointers = await scoredPointers(
      FIXTURE_WORKSPACE_ID,
      [{ id: big, labels: [] }],
      'what is the retention period for audit logs',
      picks,
    )
    const rows = pointers.get(big) ?? []
    // At most `picks` picked passages, each widened by up to 2 neighbours
    // (one either side) in the same message: picks * 3 is the ceiling,
    // whatever the neighbours' own messages turn out to be — never the
    // 3,000+ passages the chat actually has.
    expect(rows.length).toBeLessThanOrEqual(picks * 3)
    expect(rows.map((r) => r.text).join(' ')).toContain('ninety days')
  })
})

describe('tagged chats (ticket 08, Q2)', () => {
  const reply = [
    'Muse Code is a coding assistant.', 'It writes code from prompts.', 'It completes lines as you type.',
    'It suggests refactors.', 'It finds bugs.', 'It understands the whole project.',
  ].join(' ')

  it('sends a tagged chat whole when it fits — every sentence, in order', async () => {
    const a = await newChat('Muse')
    await turn(a, 'What is Muse Code?', reply)
    const b = await newChat('B')
    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'focus', taggedChatIds: [a], draftText: 'what does it do',
    })
    const text = chats[0].excerpts.map((e) => e.text).join('\n')
    for (const s of reply.split(/(?<=\.) /)) expect(text).toContain(s)
    expect(text.indexOf('writes code')).toBeLessThan(text.indexOf('finds bugs'))
  })

  it('an auto-reached chat still gets only its best passages', async () => {
    const long = Array.from({ length: 30 }, (_, i) => `Kafka partitions note ${i} about ordering.`).join(' ')
    const a = await newChat('A')
    await turn(a, 'Kafka partitions keep order.', long)
    const b = await newChat('B')
    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'explore', taggedChatIds: [], draftText: 'How do Kafka partitions keep order?',
    })
    const sent = chats.find((c) => c.id === a)!.excerpts.map((e) => e.text).join('\n').split('\n').length
    expect(sent).toBeLessThan(31)
  })

  it('fills whole chats first, falls back for the one that does not fit, and reports it', async () => {
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const id = await newChat(`T${i}`)
      await turn(id, `Chat ${i}.`, Array.from({ length: 12 }, (_, j) => `Chat ${i} line ${j} ${'word '.repeat(60)}end.`).join(' '))
      ids.push(id)
    }
    const b = await newChat('B')
    const { chats, dropped } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'focus', taggedChatIds: ids, draftText: 'summary',
    })
    const used = chats.reduce((n, c) => n + c.excerpts.reduce((m, e) => m + sentLength(e), 0), 0)
    expect(used).toBeLessThanOrEqual(8000)
    expect(dropped.length).toBeGreaterThan(0)
  })

  // Whole-branch review 2, finding 1: the planner reserved budget only for the
  // chats it sent whole, but the packer walked chats in ranked order — so a
  // larger tagged chat ranked FIRST, falling back to best passages, spent the
  // budget before the whole chat was packed, and the "whole" chat lost a message.
  it('a chat planned whole arrives whole even when a larger tagged chat is ranked before it', async () => {
    const small = await newChat('Small')
    const para = (tag: string) => Array.from({ length: 5 }, (_, j) => `${tag} sentence ${j} ${'plain '.repeat(37)}done.`).join(' ')
    for (let i = 0; i < 3; i++) await turn(small, para(`Small question ${i}`), para(`Small answer ${i}`))
    const big = await newChat('Big')
    await turn(big, 'Here is a long one.', Array.from({ length: 18 }, (_, j) => `Big line ${j} ${'detail '.repeat(140)}end.`).join(' '))
    // Tagged chats rank by most recently referenced first: put Big first.
    const db = await getDb()
    await db.update(sessions).set({ updatedAt: new Date(Date.now() + 3_600_000) }).where(eq(sessions.id, big))
    // Fix round 1: against draftText 'summary', every passage of Big scores
    // ~0, so scoredPointers' picks are decided entirely by the tie-break
    // (created_at, then message_id, then ordinal). Big's user and assistant
    // messages are two separate inserts a moment apart, but `now()`'s
    // resolution here is only a millisecond (proved with a 30-run loop: 6/30
    // tied) — a tie then falls to message_id, a fresh random uuid each run,
    // so which message's passages win the tie (Big's one-line user message,
    // short enough to fit the ~300 chars left after Small; or Big's
    // 18-passage assistant message, whose picks are ~1,000-char lines that
    // never fit) was a coin flip, and on a loss Big never gets a slot in
    // `chats` at all. The user message really was said first — pin that down
    // instead of leaving it to clock resolution, so Big's short excerpt
    // always wins the tie and this test's own premise (Big present, ranked
    // first) always holds.
    await db
      .update(messages)
      .set({ createdAt: sql`${messages.createdAt} - interval '1 second'` })
      .where(and(eq(messages.sessionId, big), eq(messages.role, 'user')))
    const b = await newChat('B')
    const { chats, dropped } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'focus', taggedChatIds: [big, small], draftText: 'summary',
    })
    // Listed in ranked order, whatever order the budget was spent in.
    expect(chats[0].id).toBe(big)
    const got = chats.find((c) => c.id === small)!
    const text = got.excerpts.map((e) => e.text).join('\n')
    // Every sentence of every one of Small's six messages is there.
    for (let i = 0; i < 3; i++) {
      for (const m of [para(`Small question ${i}`), para(`Small answer ${i}`)]) {
        for (const sentence of m.split(/(?<=done\.) /)) expect(text).toContain(sentence)
      }
    }
    expect(dropped).not.toContain(got.title)
    const used = chats.reduce((n, c) => n + c.excerpts.reduce((m, e) => m + sentLength(e), 0), 0)
    expect(used).toBeLessThanOrEqual(8000)
  })

  // Whole-branch review 2, finding 3: sending a chat whole reads its raw
  // message text. A message padded to ~200k chars around a few short sentences
  // has few passages, so it looked like it fitted — and reading it blocked
  // every visitor. Past PROVISIONAL.wholeChatRawCharLimit it gets best passages.
  it('a tagged chat with a huge raw message is not sent whole', async () => {
    const padded = await newChat('Padded')
    const pad = ' '.repeat(10_000)
    const sentences = Array.from({ length: 20 }, (_, j) => `Short fact number ${j} is here.`)
    await turn(padded, 'Here.', sentences.join(pad))
    const b = await newChat('B')
    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'focus', taggedChatIds: [padded], draftText: 'what is fact number 7',
    })
    const lines = chats[0].excerpts.map((e) => e.text).join('\n').split('\n')
    // Whole would be all 20 facts plus the question; best passages are at most
    // `windowsPerChat` picks, each widened by one neighbour either side.
    expect(lines.length).toBeLessThanOrEqual(PROVISIONAL.windowsPerChat * 3)
    expect(chats[0].excerpts.map((e) => e.text).join('\n')).toContain('Short fact number 7 is here.')
  })

  it('a tagged chat with nothing said yet adds no memory and does not crash', async () => {
    const empty = await newChat('Empty')
    const b = await newChat('B')
    const { chats } = await retrieveContext({
      workspaceId: FIXTURE_WORKSPACE_ID, sessionId: b, mode: 'focus', taggedChatIds: [empty], draftText: 'anything',
    })
    expect(chats).toEqual([])
  })
})
