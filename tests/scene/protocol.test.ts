import { describe, it, expect } from 'vitest'
import { acceptFrameMessage, isFromFrame, shouldAutoRepair } from '@/scene/runtime/protocol'
import { classifyWorkerError } from '@/scene/runtime/run'
import { workerScript } from '@/scene/runtime/wrap'

describe('isFromFrame', () => {
  it('accepts the four message shapes', () => {
    expect(isFromFrame({ type: 'ready' })).toBe(true)
    expect(isFromFrame({ type: 'height', px: 420 })).toBe(true)
    expect(isFromFrame({ type: 'error', kind: 'timeout', message: 'x' })).toBe(true)
    expect(isFromFrame({ type: 'done' })).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isFromFrame(null)).toBe(false)
    expect(isFromFrame({ type: 'height', px: '420' })).toBe(false)
    expect(isFromFrame({ type: 'error', kind: 'boom', message: 'x' })).toBe(false)
    expect(isFromFrame({ type: 'navigate', to: 'https://evil.example' })).toBe(false)
  })
})

describe('acceptFrameMessage', () => {
  const frame = {}
  it('accepts a valid message from its own frame only', () => {
    expect(acceptFrameMessage({ source: frame, data: { type: 'done' } }, frame)).toEqual({ type: 'done' })
    expect(acceptFrameMessage({ source: {}, data: { type: 'done' } }, frame)).toBeNull()
    expect(acceptFrameMessage({ source: null, data: { type: 'done' } }, null)).toBeNull()
    expect(acceptFrameMessage({ source: frame, data: { type: 'nope' } }, frame)).toBeNull()
  })
})

describe('shouldAutoRepair', () => {
  const base = { fresh: true, attempts: 0, kind: 'error' as const, canRepair: true }
  it('repairs a fresh failure, at most twice', () => {
    expect(shouldAutoRepair(base)).toBe(true)
    expect(shouldAutoRepair({ ...base, attempts: 1 })).toBe(true)
    expect(shouldAutoRepair({ ...base, attempts: 2 })).toBe(false)
  })
  it('never repairs an old chat, an unsupported browser, or without a message to repair', () => {
    expect(shouldAutoRepair({ ...base, fresh: false })).toBe(false)
    expect(shouldAutoRepair({ ...base, kind: 'unsupported' })).toBe(false)
    expect(shouldAutoRepair({ ...base, canRepair: false })).toBe(false)
  })
})

describe('classifyWorkerError', () => {
  it('turns a limits error into the limits kind', () => {
    expect(classifyWorkerError('Uncaught Error: [limits] more than 400 shapes')).toEqual({
      kind: 'limits', message: 'This diagram is too large: more than 400 shapes',
    })
  })
  it('keeps other errors readable', () => {
    expect(classifyWorkerError('Uncaught ReferenceError: sphere is not defined')).toEqual({
      kind: 'error', message: 'ReferenceError: sphere is not defined',
    })
  })
})

describe('workerScript', () => {
  it('wraps the code between begin and end, in strict mode, with the slider values', () => {
    const s = workerScript('/*LIB*/', 'play(create(ax))', { k: 2 })
    expect(s.indexOf('/*LIB*/')).toBe(0)
    expect(s).toContain('__minddyte_begin({"k":2});')
    expect(s).toContain('"use strict";\nplay(create(ax))\n')
    expect(s.trimEnd().endsWith('__minddyte_end();')).toBe(true)
  })
})
