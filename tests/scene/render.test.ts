import { describe, it, expect } from 'vitest'
import { captionAt, frameAt, lerpShape, smooth, totalDuration } from '@/scene/runtime/render'
import { createSceneBuilder } from '@/scene/runtime/lib'
import type { Poly, Scene } from '@/scene/types'

const sceneOf = (fn: (api: ReturnType<typeof createSceneBuilder>['api']) => void): Scene => {
  const b = createSceneBuilder({})
  fn(b.api)
  return b.finish()
}

describe('smooth', () => {
  it('eases from 0 to 1, symmetric', () => {
    expect(smooth(0)).toBe(0)
    expect(smooth(1)).toBe(1)
    expect(smooth(0.5)).toBe(0.5)
    expect(smooth(0.25)).toBeLessThan(0.25)
    expect(smooth(-1)).toBe(0)
    expect(smooth(2)).toBe(1)
  })
})

describe('lerpShape', () => {
  it('interpolates polylines of different lengths', () => {
    const a: Poly = { kind: 'poly', points: [[0, 0], [2, 0]], closed: false, stroke: '#fff', width: 0.1, fill: null }
    const b: Poly = { ...a, points: [[0, 2], [1, 2], [2, 2]] }
    const mid = lerpShape(a, b, 0.5) as Poly
    expect(mid.points).toEqual([[0, 1], [1, 1], [2, 1]])
  })
  it('switches non-numeric properties at the halfway point', () => {
    const a = { kind: 'label' as const, at: [0, 0] as [number, number], text: 'a', tex: false, color: '#fff', size: 0.4 }
    const b = { ...a, text: 'b' }
    expect((lerpShape(a, b, 0.49) as typeof a).text).toBe('a')
    expect((lerpShape(a, b, 0.5) as typeof a).text).toBe('b')
  })
})

describe('frameAt', () => {
  const scene = sceneOf(({ point, play, create, move, caption, wait }) => {
    const p = point([0, 0])
    caption('appear')
    play(create(p))
    caption('slide')
    play(move(p, [2, 0]))
    play(wait(1))
  })

  it('knows the total duration', () => {
    expect(totalDuration(scene)).toBe(3)
  })

  it('starts invisible, then fades a point in', () => {
    expect([...frameAt(scene, 0).values()].every((v) => v.opacity === 0)).toBe(true)
    const half = frameAt(scene, 0.5)
    expect([...half.values()][0].opacity).toBeCloseTo(0.5)
  })

  it('moves the point during the second step, and holds it after', () => {
    const at = (t: number) => ([...frameAt(scene, t).values()][0].shape as { c: [number, number] }).c[0]
    expect(at(1)).toBeCloseTo(0)
    expect(at(1.5)).toBeCloseTo(1)
    expect(at(2)).toBeCloseTo(2)
    expect(at(3)).toBeCloseTo(2)
  })

  it('traces a line in rather than fading it', () => {
    const line = sceneOf(({ vector, play, create }) => { play(create(vector([3, 0]))) })
    const shaft = [...frameAt(line, 0.5).values()][0]
    expect(shaft.draw).toBeCloseTo(0.5)
    expect(shaft.opacity).toBe(1)
  })

  it('removes faded-out shapes at the end of the step', () => {
    const s = sceneOf(({ point, play, create, fadeOut }) => { const p = point([0, 0]); play(create(p)); play(fadeOut(p)) })
    expect(frameAt(s, 1.5).size).toBe(1)
    expect(frameAt(s, 2).size).toBe(0)
  })
})

describe('captionAt', () => {
  it('shows the latest caption of a step that has started', () => {
    const s = sceneOf(({ point, play, create, caption, wait }) => {
      caption('one'); play(create(point([0, 0])))
      play(wait(1))
      caption('three'); play(wait(1))
    })
    expect(captionAt(s, 0)).toBe('one')
    expect(captionAt(s, 1.5)).toBe('one')
    expect(captionAt(s, 2.1)).toBe('three')
  })
})
