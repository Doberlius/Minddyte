import { describe, it, expect } from 'vitest'
import { layoutGraph } from '@/lib/graph-layout'
import {
  buildBrainGraph,
  chatNodeId,
  conceptNodeId,
  CONCEPT_FADE,
  fadeAt,
  fadedColor,
  loneCounts,
  mapGraph,
  nodeIdOf,
  selectionOf,
  type BrainPalette,
} from '@/components/graph/sigma/brainGraph'
import { wrapLines } from '@/components/graph/sigma/drawCard'
import fixtures from '../fixtures/view-graphs.json'
import type { ViewGraph } from '@/types/graph'

const seeded = fixtures.seeded as unknown as ViewGraph

const palette: BrainPalette = {
  surface: '#fff',
  ink: '#111',
  ink2: '#222',
  ink3: '#333',
  violet: '#4F46E8',
  border: '#eee',
  pillBorder: '#ddd',
  lineQuiet: '#ccc',
  lineStrong: '#8C84E4',
}
const estimate = (label: string) => label.length * 7 + 52

/** The way SigmaBrain builds it: the full graph, laid out without its lone concepts. */
function build(graph: ViewGraph, highlight: string[] = []) {
  return buildBrainGraph(graph, layoutGraph(mapGraph(graph)), {
    highlight,
    highlightLabel: 'open',
    palette,
    pillWidth: estimate,
  })
}

describe('what the Brain map draws', () => {
  const lone = seeded.nodes.filter((n) => n.chatIds.length === 1)
  const shared = seeded.nodes.filter((n) => n.chatIds.length > 1)
  const data = build(seeded)
  const drawn = new Set(data.nodes.map((n) => n.key))
  const node = (key: string) => data.nodes.find((n) => n.key === key)!

  it('the fixture has both kinds, or these tests prove nothing', () => {
    expect(lone.length).toBeGreaterThan(0)
    expect(shared.length).toBeGreaterThan(0)
  })

  it('draws every chat and every linked concept, and never a lone one', () => {
    for (const c of seeded.chats) expect(drawn.has(chatNodeId(c.id)), c.id).toBe(true)
    for (const n of shared) expect(drawn.has(conceptNodeId(n.key)), n.key).toBe(true)
    for (const n of lone) expect(drawn.has(conceptNodeId(n.key)), n.key).toBe(false)
    expect(data.nodes).toHaveLength(seeded.chats.length + shared.length)
  })

  it('lays out only what it draws', () => {
    expect(mapGraph(seeded).nodes.map((n) => n.key)).toEqual(shared.map((n) => n.key))
  })

  it('counts the lone concepts of each chat for its "+N", and the counts add up', () => {
    const counts = loneCounts(seeded)
    let total = 0
    for (const chat of seeded.chats) {
      const own = lone.filter((n) => n.chatIds[0] === chat.id).length
      expect(node(chatNodeId(chat.id)).attributes.extra, chat.id).toBe(own)
      expect(counts.get(chat.id) ?? 0).toBe(own)
      total += own
    }
    expect(total).toBe(lone.length)
  })

  it('fades linked concepts with the zoom, and never the chat cards', () => {
    for (const n of shared) {
      const a = node(conceptNodeId(n.key)).attributes
      expect([a.fadeFrom, a.fadeTo], n.key).toEqual([CONCEPT_FADE.from, CONCEPT_FADE.to])
    }
    for (const c of seeded.chats) expect(node(chatNodeId(c.id)).attributes.fadeTo).toBe(0)
  })

  it('never uses an attribute Sigma reserves for hiding a node', () => {
    // A count stored as `hidden` made Sigma skip every chat that had one.
    for (const n of data.nodes) expect('hidden' in n.attributes, n.key).toBe(false)
  })

  it('draws one line per chat holding a linked concept, and none to lone ones', () => {
    const expected = shared.reduce((s, n) => s + n.chatIds.length, 0)
    expect(data.edges).toHaveLength(expected)
    for (const e of data.edges) expect(drawn.has(e.target), e.target).toBe(true)
  })

  it('fills the highlighted chat violet and no other', () => {
    const open = seeded.chats[0].id
    const hl = build(seeded, [open])
    for (const n of hl.nodes.filter((n) => n.attributes.kind === 'chat')) {
      const mine = n.key === chatNodeId(open)
      expect(n.attributes.mine).toBe(mine)
      expect(n.attributes.color).toBe(mine ? palette.violet : palette.surface)
    }
  })

  it('flips y, because Sigma counts it upward and the layout downward', () => {
    const chat = layoutGraph(mapGraph(seeded)).chats[1]
    const a = node(chatNodeId(chat.id)).attributes
    expect(a.x).toBe(chat.x)
    expect(a.y).toBe(-chat.y)
  })

  it('maps selections to canvas ids and back', () => {
    for (const s of [{ kind: 'chat', id: 'abc-1' }, { kind: 'concept', key: 'postgresql' }] as const) {
      expect(selectionOf(nodeIdOf(s))).toEqual(s)
    }
    expect(selectionOf('something-else')).toBeNull()
  })
})

describe('the zoom fade', () => {
  it('is off below the range, on above it, and rises steadily between', () => {
    expect(fadeAt(CONCEPT_FADE.from - 0.1)).toBe(0)
    expect(fadeAt(CONCEPT_FADE.from)).toBe(0)
    expect(fadeAt(CONCEPT_FADE.to)).toBe(1)
    expect(fadeAt(CONCEPT_FADE.to + 1)).toBe(1)
    expect(fadeAt((CONCEPT_FADE.from + CONCEPT_FADE.to) / 2)).toBeCloseTo(0.5, 5)
    let last = 0
    for (let k = CONCEPT_FADE.from; k <= CONCEPT_FADE.to; k += 0.01) {
      expect(fadeAt(k)).toBeGreaterThanOrEqual(last)
      last = fadeAt(k)
    }
  })

  it('is complete below the 0.6 zoom a first frame is held to, so the map opens with its links', () => {
    expect(CONCEPT_FADE.to).toBeLessThan(0.6)
  })

  it('treats a node with no range as always drawn', () => {
    expect(fadeAt(0, 0, 0)).toBe(1)
  })

  it('premultiplies a faded line colour, which is how Sigma blends it', () => {
    // #8C84E4 at a quarter: each channel a quarter of its value.
    expect(fadedColor('#8C84E4', 0.25)).toBe('rgba(35,33,57,0.25)')
    expect(fadedColor('#8C84E4', 1)).toBe('rgba(140,132,228,1)')
  })
})

describe('wrapLines (card titles on the canvas)', () => {
  // One unit per character keeps the arithmetic visible.
  const measure = (t: string) => t.length

  it('keeps a short title on one line', () => {
    expect(wrapLines(measure, 'Kafka ordering', 20, 2)).toEqual(['Kafka ordering'])
  })

  it('wraps onto a second line', () => {
    expect(wrapLines(measure, 'Kafka partition ordering', 16, 2)).toEqual(['Kafka partition', 'ordering'])
  })

  it('ends the last line with an ellipsis when words are left over', () => {
    const lines = wrapLines(measure, 'one two three four five six', 9, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1].endsWith('…')).toBe(true)
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(9)
  })

  it('cuts a single word too long for the line', () => {
    const [line] = wrapLines(measure, 'Supercalifragilistic', 8, 2)
    expect(line.endsWith('…')).toBe(true)
    expect(measure(line)).toBeLessThanOrEqual(8)
  })

  it('returns nothing for an empty title', () => {
    expect(wrapLines(measure, '   ', 10, 2)).toEqual([])
  })
})
