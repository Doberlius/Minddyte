import { describe, expect, it } from 'vitest'
import { RECORD_SEPARATOR } from '@/lib/compaction'
import { buildMemoryBlock, buildSystemPrompt, type MemoryChat } from '@/lib/prompt'

const chat = (over: Partial<MemoryChat> = {}): MemoryChat => ({
  title: 'Event streaming',
  compaction: `First sentence.${RECORD_SEPARATOR}Second sentence.`,
  why: 'shares kafka',
  ...over,
})

describe('buildMemoryBlock', () => {
  it('converts the record separator to newlines so no control character reaches the model', () => {
    const block = buildMemoryBlock([chat()])
    expect(block).not.toContain(RECORD_SEPARATOR)
    expect(block).toContain('First sentence.\nSecond sentence.')
  })

  it('heads each chat with its title and the reason it was reached', () => {
    expect(buildMemoryBlock([chat()])).toContain('## Event streaming  (shares kafka)')
  })

  it('separates chats with a blank line', () => {
    const block = buildMemoryBlock([chat(), chat({ title: 'Second chat' })])
    expect(block).toContain('\n\n## Second chat')
  })

  it('returns an empty string for no chats', () => {
    expect(buildMemoryBlock([])).toBe('')
  })
})

describe('buildSystemPrompt', () => {
  it('focus forbids outside knowledge', () => {
    const p = buildSystemPrompt('focus', [chat()])
    expect(p).toContain('ONLY the memory below')
    expect(p).toContain('First sentence.')
  })

  it('explore permits general knowledge', () => {
    expect(buildSystemPrompt('explore', [chat()])).toContain('general knowledge')
  })

  it('focus with no memory says so without inviting speculation', () => {
    expect(buildSystemPrompt('focus', [])).toContain('No memory loaded.')
  })

  it('explore with no memory falls back to this conversation alone', () => {
    expect(buildSystemPrompt('explore', [])).toContain('answering from this conversation alone')
  })
})
