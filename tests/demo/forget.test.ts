import { describe, it, expect } from 'vitest'
import { forget, sendMessage, chatById, nodeByKey, emptyGraph } from '@/demo/graph'
import { seededGraph } from '@/demo/seed'
import { RECORD_SEPARATOR } from '@/lib/compaction'

/**
 * Forgetting, as the glossary defines it: deleting a Node from a Chat makes
 * that Node's sentences permanently ineligible for the Chat's Compaction. The
 * message stays readable in the conversation; the assistant can never see it
 * again.
 *
 * Both halves of that sentence are load-bearing and both are asserted here.
 * A version that only unlinks the Node would leave the sentence sitting in the
 * memory the assistant receives — the user would have been told their data was
 * gone while it was still being sent.
 */

const SAFETY = 'safety'

function memory(graph: ReturnType<typeof seededGraph>, chatId: string): string[] {
  return (chatById(graph, chatId)?.compaction ?? '').split(RECORD_SEPARATOR).filter(Boolean)
}

describe('forget', () => {
  it('unlinks the concept from that conversation', () => {
    const before = seededGraph()
    expect(nodeByKey(before, 'garbagecollector')!.chatIds).toContain(SAFETY)

    const after = forget(before, { chatId: SAFETY, label: 'garbage collector' })

    expect(nodeByKey(after, 'garbagecollector')!.chatIds).not.toContain(SAFETY)
  })

  it('keeps the concept alive while another conversation still holds it', () => {
    // 'garbage collector' is in both `lang` and `safety`; losing one is not
    // losing the concept.
    const after = forget(seededGraph(), { chatId: SAFETY, label: 'garbage collector' })

    expect(nodeByKey(after, 'garbagecollector')!.chatIds).toEqual(['lang'])
  })

  it('removes the concept entirely when no conversation holds it any more', () => {
    // 'Ownership' belongs to `safety` alone.
    const after = forget(seededGraph(), { chatId: SAFETY, label: 'Ownership' })

    expect(nodeByKey(after, 'ownership')).toBeUndefined()
  })

  it('takes the forgotten sentence out of the memory', () => {
    const before = seededGraph()
    expect(memory(before, SAFETY)).toContain('Rust has no garbage collector.')

    const after = forget(before, { chatId: SAFETY, label: 'garbage collector' })

    expect(memory(after, SAFETY)).not.toContain('Rust has no garbage collector.')
  })

  it('leaves every other sentence of that conversation untouched', () => {
    const after = forget(seededGraph(), { chatId: SAFETY, label: 'garbage collector' })

    expect(memory(after, SAFETY)).toContain('Ownership decides when memory is freed.')
  })

  it('leaves the message itself readable in the transcript', () => {
    // The glossary is explicit: the conversation keeps its words. Only the
    // memory handed to the assistant loses them.
    const after = forget(seededGraph(), { chatId: SAFETY, label: 'garbage collector' })

    expect(chatById(after, SAFETY)!.messages[0].content).toContain('garbage collector')
  })

  it('does not bring the concept back when it is said again', () => {
    // "Permanently ineligible" — otherwise Forgetting is a gesture that undoes
    // itself the next time the subject comes up, which is worse than not
    // offering it.
    let graph = forget(seededGraph(), { chatId: SAFETY, label: 'garbage collector' })
    graph = sendMessage(graph, {
      chatId: SAFETY,
      userText: 'A garbage collector would pause the program at the wrong moment.',
    })

    expect(nodeByKey(graph, 'garbagecollector')!.chatIds).not.toContain(SAFETY)
    expect(memory(graph, SAFETY).join(' ')).not.toContain('garbage collector')
  })

  it('still records the rest of a message that mentions a forgotten concept', () => {
    let graph = forget(seededGraph(), { chatId: SAFETY, label: 'garbage collector' })
    graph = sendMessage(graph, {
      chatId: SAFETY,
      userText: 'A garbage collector pauses the program. Kubernetes schedules it anyway.',
    })

    expect(memory(graph, SAFETY)).toContain('Kubernetes schedules it anyway.')
    expect(nodeByKey(graph, 'kubernetes')!.chatIds).toContain(SAFETY)
  })

  it('ignores a label the conversation never held', () => {
    const before = seededGraph()
    const after = forget(before, { chatId: SAFETY, label: 'Haskell' })

    expect(after.nodes).toHaveLength(before.nodes.length)
    expect(memory(after, SAFETY)).toEqual(memory(before, SAFETY))
  })

  it('ignores a conversation that does not exist', () => {
    const before = seededGraph()
    expect(forget(before, { chatId: 'nope', label: 'Rust' })).toEqual(before)
  })

  it('leaves the original graph untouched', () => {
    const before = seededGraph()
    const nodeCount = before.nodes.length
    forget(before, { chatId: SAFETY, label: 'Ownership' })

    expect(before.nodes).toHaveLength(nodeCount)
    expect(memory(before, SAFETY)).toContain('Rust has no garbage collector.')
  })
})

describe('forget, on a markdown reply', () => {
  // withoutForgotten used to re-join kept sentences with spaces, flattening
  // headings and tables into one paragraph — so once the Compaction parses
  // markdown, a chat with anything forgotten would leak markup back in.
  it('keeps markup out of the rebuilt Compaction', () => {
    const reply = '## Stack\n\n| Tool | Use |\n|---|---|\n| Redis | cache |\n\nRedis caches sessions. Kafka carries events.'
    let g = sendMessage(emptyGraph(), { chatId: 'c', userText: 'I use Redis and Kafka together.', assistantText: reply })
    g = forget(g, { chatId: 'c', label: 'Kafka' })
    const kept = (chatById(g, 'c')?.compaction ?? '').split(RECORD_SEPARATOR).filter(Boolean)
    expect(kept).toContain('Redis caches sessions.')
    expect(kept.some((s) => s.includes('|') || s.includes('#'))).toBe(false)
  })
})
