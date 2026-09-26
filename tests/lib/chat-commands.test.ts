import { describe, expect, it } from 'vitest'
import { HELP_ENTRIES, SLASH_ENTRIES, exactCommand, matchCommands, modeLabel } from '@/components/chat/commands'

describe('the one list of working commands', () => {
  it('holds exactly the commands that work', () => {
    expect(HELP_ENTRIES.map((e) => e.label)).toEqual(['/mode explore', '/mode focus', '@', 'About you', '/forget', '/help'])
  })
  it('gives every entry a plain description and an example', () => {
    for (const e of HELP_ENTRIES) {
      expect(e.what.length).toBeGreaterThan(10)
      expect(e.example.length).toBeGreaterThan(0)
    }
  })
  it('only slash entries can be run from the / menu', () => {
    expect(SLASH_ENTRIES.every((e) => e.action)).toBe(true)
    expect(SLASH_ENTRIES.find((e) => e.label === '@')).toBeUndefined()
    expect(SLASH_ENTRIES.find((e) => e.label === 'About you')).toBeUndefined()
  })
  it('matches what is typed after the slash', () => {
    expect(matchCommands('hel').map((e) => e.label)).toEqual(['/help'])
    expect(matchCommands('mode f').map((e) => e.label)).toEqual(['/mode focus'])
    expect(matchCommands('').length).toBe(4)
    expect(matchCommands('xyz')).toEqual([])
  })
  it('/help resolves to the help action, never to a mode', () => {
    expect(matchCommands('help')[0].action).toEqual({ kind: 'help' })
  })
  it('/forget runs the forget action, and its description says the messages stay', () => {
    const entry = exactCommand('/forget')
    expect(entry?.action).toEqual({ kind: 'forget' })
    expect(entry?.what).toMatch(/messages stay/i)
    expect(matchCommands('forg').map((e) => e.label)).toEqual(['/forget'])
  })
})

// Whole-branch review 2, finding 2: clicking Send on "/help" sent it to the
// model and saved it. Send now runs a message that IS a command, exactly.
describe('exactCommand', () => {
  it('matches a message that is exactly a command, ignoring case and spaces', () => {
    expect(exactCommand('/help')?.action).toEqual({ kind: 'help' })
    expect(exactCommand(' /HELP ')?.action).toEqual({ kind: 'help' })
    expect(exactCommand('/mode focus')?.action).toEqual({ kind: 'mode', mode: 'focus' })
    expect(exactCommand('/Mode Explore')?.action).toEqual({ kind: 'mode', mode: 'explore' })
  })
  it('leaves an ordinary message alone', () => {
    expect(exactCommand('/help me with kafka')).toBeUndefined()
    expect(exactCommand('help')).toBeUndefined()
    expect(exactCommand('@')).toBeUndefined()
    expect(exactCommand('')).toBeUndefined()
  })
})

describe('focus copy', () => {
  it('names this chat as well as the chats added with @', () => {
    expect(HELP_ENTRIES.find((e) => e.label === '/mode focus')!.what).toBe(
      'Answer only from this chat and the chats you add with @. If the answer is not there, it says so.',
    )
  })
})

describe('modeLabel', () => {
  it('is the one place that spells out a mode for a person to read', () => {
    expect(modeLabel('focus')).toBe('Focus')
    expect(modeLabel('explore')).toBe('Explore')
  })
})
