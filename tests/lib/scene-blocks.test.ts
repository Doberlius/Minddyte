import { describe, it, expect } from 'vitest'
import { extractSceneCode, findSceneBlocks, isSingleSceneBody, replaceSceneBlock } from '@/lib/scene/blocks'

const reply = [
  'Here is the idea.',
  '',
  '```scene',
  'const ax = axes()',
  'play(create(ax))',
  '```',
  '',
  'And the code in Python:',
  '',
  '```python',
  'print(1)',
  '```',
  '',
  '~~~scene',
  'play(create(array([1, 2])))',
  '~~~',
  'Done.',
].join('\n')

describe('findSceneBlocks', () => {
  it('finds closed scene blocks with their code and exact span', () => {
    const blocks = findSceneBlocks(reply)
    expect(blocks.map((b) => b.code)).toEqual(['const ax = axes()\nplay(create(ax))', 'play(create(array([1, 2])))'])
    expect(reply.slice(blocks[0].start, blocks[0].end)).toBe('```scene\nconst ax = axes()\nplay(create(ax))\n```')
    expect(reply.slice(blocks[1].start, blocks[1].end)).toBe('~~~scene\nplay(create(array([1, 2])))\n~~~')
  })

  it('ignores an unclosed block (still streaming)', () => {
    expect(findSceneBlocks('Text\n\n```scene\nplay(create(axes()))\n')).toEqual([])
  })

  it('ignores a scene fence shown inside another code block', () => {
    const md = '````markdown\n```scene\nplay()\n```\n````'
    expect(findSceneBlocks(md)).toEqual([])
  })

  it('needs the info string to be exactly scene', () => {
    expect(findSceneBlocks('```scenes\nx\n```')).toEqual([])
    expect(findSceneBlocks('```scene \nx\n```').length).toBe(1)
  })

  it('handles CRLF line endings', () => {
    expect(findSceneBlocks('a\r\n```scene\r\nplay()\r\n```\r\nb').map((b) => b.code)).toEqual(['play()'])
  })
})

describe('replaceSceneBlock', () => {
  it('replaces only the block at the index, keeping its fence', () => {
    const next = replaceSceneBlock(reply, 1, 'play(create(array([3])))')!
    expect(next).toContain('~~~scene\nplay(create(array([3])))\n~~~')
    expect(next).toContain('```scene\nconst ax = axes()\nplay(create(ax))\n```')
    expect(next.startsWith('Here is the idea.')).toBe(true)
    expect(next.endsWith('Done.')).toBe(true)
  })

  it('returns null for an index that does not exist', () => {
    expect(replaceSceneBlock(reply, 2, 'x')).toBeNull()
    expect(replaceSceneBlock(reply, -1, 'x')).toBeNull()
  })
})

describe('isSingleSceneBody', () => {
  it('rejects code that could close or open a fence', () => {
    expect(isSingleSceneBody('play()\n```\nhello')).toBe(false)
    expect(isSingleSceneBody('  ~~~\n')).toBe(false)
    expect(isSingleSceneBody('const s = "```"')).toBe(true)
    expect(isSingleSceneBody('play(create(axes()))')).toBe(true)
  })
  it('rejects empty code', () => {
    expect(isSingleSceneBody('   \n')).toBe(false)
  })
})

describe('extractSceneCode', () => {
  it('returns the first scene block of a model reply', () => {
    expect(extractSceneCode('Fixed:\n\n```scene\nplay(create(axes()))\n```\n')).toBe('play(create(axes()))')
  })
  it('returns null when there is none', () => {
    expect(extractSceneCode('Sorry, I cannot.')).toBeNull()
  })
})
