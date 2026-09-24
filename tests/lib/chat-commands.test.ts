import { describe, expect, it } from 'vitest'
import { HELP_ENTRIES, SLASH_ENTRIES, matchCommands, modeLabel } from '@/components/chat/commands'

describe('the one list of working commands', () => {
  it('holds exactly the commands that work', () => {
    expect(HELP_ENTRIES.map((e) => e.label)).toEqual(['/mode explore', '/mode focus', '@', '/help'])
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
  })
  it('matches what is typed after the slash', () => {
    expect(matchCommands('hel').map((e) => e.label)).toEqual(['/help'])
    expect(matchCommands('mode f').map((e) => e.label)).toEqual(['/mode focus'])
    expect(matchCommands('').length).toBe(3)
    expect(matchCommands('xyz')).toEqual([])
  })
  it('/help resolves to the help action, never to a mode', () => {
    expect(matchCommands('help')[0].action).toEqual({ kind: 'help' })
  })
})

describe('modeLabel', () => {
  it('is the one place that spells out a mode for a person to read', () => {
    expect(modeLabel('focus')).toBe('Focus')
    expect(modeLabel('explore')).toBe('Explore')
  })
})
