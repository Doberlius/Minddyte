import { describe, expect, it } from 'vitest'
import { emptyGraph, sendMessage } from '@/demo/graph'
import { seededGraph } from '@/demo/seed'
import { demoRetrieve } from '@/demo/retrieve'
import { RECORD_SEPARATOR } from '@/lib/compaction'
import { AUTO_REACH_CAP } from '@/lib/rank'

/**
 * The two modes, and the memory that made the Archive unreadable.
 */

describe('demoRetrieve', () => {
  const graph = sendMessage(seededGraph(), {
    chatId: 'mine',
    userText: 'We run PostgreSQL on Kubernetes in production.',
  })

  it('explore reaches conversations sharing a concept', () => {
    const reached = demoRetrieve(graph, {
      chatId: 'mine',
      mode: 'explore',
      taggedChatIds: [],
      draftText: 'More about PostgreSQL.',
    })

    expect(reached.length).toBeGreaterThan(0)
    expect(reached.every((r) => r.kind === 'overlap')).toBe(true)
    expect(reached.every((r) => r.id !== 'mine')).toBe(true)
  })

  it('focus reaches nothing that was not tagged', () => {
    const reached = demoRetrieve(graph, {
      chatId: 'mine',
      mode: 'focus',
      taggedChatIds: [],
      draftText: 'More about PostgreSQL.',
    })

    expect(reached).toEqual([])
  })

  it('a tagged conversation comes back in focus, where nothing else does', () => {
    const reached = demoRetrieve(graph, {
      chatId: 'mine',
      mode: 'focus',
      taggedChatIds: ['lang'],
      draftText: 'Nothing in here matches anything.',
    })

    expect(reached).toHaveLength(1)
    expect(reached[0].id).toBe('lang')
    expect(reached[0].kind).toBe('tagged')
  })

  it('caps automatic reach but never the tags', () => {
    const reached = demoRetrieve(graph, {
      chatId: 'mine',
      mode: 'explore',
      taggedChatIds: ['lang', 'safety'],
      draftText: 'PostgreSQL and Kubernetes and Docker Compose.',
    })

    const auto = reached.filter((r) => r.kind === 'overlap')
    const tagged = reached.filter((r) => r.kind === 'tagged')
    expect(auto.length).toBeLessThanOrEqual(AUTO_REACH_CAP)
    expect(tagged.map((t) => t.id).sort()).toEqual(['lang', 'safety'])
  })

  it('never reaches the conversation you are in', () => {
    const reached = demoRetrieve(graph, {
      chatId: 'mine',
      mode: 'explore',
      taggedChatIds: ['mine'],
      draftText: 'PostgreSQL.',
    })

    expect(reached.every((r) => r.id !== 'mine')).toBe(true)
  })
})

describe('the memory a demo turn leaves behind', () => {
  /**
   * Reported from the demo: after typing "daa", "ada", "dada", the Archive
   * showed the memory as three copies of "No concept was firm enough to index
   * there. I saw daa, but a single lowercase word is only ever suggested…" —
   * the demo's own report, not the visitor's words, filling a 500-character
   * cap that the visitor's sentences were then trimmed out of.
   */
  const report =
    'No concept was firm enough to index there. I saw daa, but a single lowercase word is only ever suggested, never indexed on its own. Naming a tool or a library usually gives the extractor something to hold.'

  it('keeps the visitor’s words and not the report', () => {
    let g = emptyGraph()
    for (const word of ['daa', 'ada', 'dada']) {
      g = sendMessage(g, {
        chatId: 'mine',
        userText: word,
        assistantText: report,
        rememberAssistant: false,
      })
    }

    const memory = g.chats[0].compaction.split(RECORD_SEPARATOR).filter(Boolean)
    expect(memory.join(' ')).not.toContain('No concept was firm enough')
    expect(memory.join(' ')).not.toContain('single lowercase word')
    // What is left is what was actually said.
    expect(memory.some((s) => s.includes('dada'))).toBe(true)
  })

  it('still remembers an authored reply, which is what the seeds carry', () => {
    const g = sendMessage(emptyGraph(), {
      chatId: 'seeded',
      userText: 'We decided to use PostgreSQL.',
      assistantText: 'Relational integrity matters once rows reference each other.',
    })

    expect(g.chats[0].compaction).toContain('Relational integrity matters')
  })
})
