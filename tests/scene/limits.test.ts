import { describe, it, expect } from 'vitest'
import { createSceneBuilder } from '@/scene/runtime/lib'
import { withinLimits } from '@/scene/runtime/limits'
import { LIMITS, type Scene, type Shape } from '@/scene/types'

const build = (fn: (api: ReturnType<typeof createSceneBuilder>['api']) => void) => {
  const b = createSceneBuilder({})
  fn(b.api)
  return b.finish()
}

describe('withinLimits', () => {
  // Regression: a move-heavy but perfectly ordinary diagram used to be
  // rejected as "too large". `move()`/`transform()`/`lanes().consume` each
  // emit one `change` op per id, every time they run, completely unbounded
  // by `createSceneBuilder` — an axes + one dot, moved a dozen times, was
  // measured at 35 shapes / 13 steps but 455 total create+change op-id
  // references, comfortably past LIMITS.shapes (400) on that count alone.
  // `withinLimits` must not look at op-id counts at all any more.
  it('accepts a small diagram with many move() calls, however many op ids that produces', () => {
    const scene = build(({ axes, point, move, play, create }) => {
      const ax = axes({ x: [-1, 1], y: [-1, 1] })
      const dot = point([0, 0])
      play(create(ax))
      play(create(dot))
      for (let i = 0; i < 12; i++) play(move([ax, dot], [0.05, 0.05]))
    })

    // Sanity: this really is the shape of the regression, not a fluke —
    // shapes/steps are nowhere near LIMITS, but the op-id total is well
    // past LIMITS.shapes.
    const shapeCount = Object.keys(scene.shapes).length
    expect(shapeCount).toBeLessThan(LIMITS.shapes)
    expect(scene.steps.length).toBeLessThan(LIMITS.steps)
    let opIds = 0
    for (const step of scene.steps) {
      for (const op of step.ops) {
        if (op.op === 'create') opIds += op.ids.length
        else if (op.op === 'change') opIds += 1
      }
    }
    expect(opIds).toBeGreaterThan(LIMITS.shapes)

    expect(withinLimits(scene)).toBe(true)
  })

  it('accepts a scene with no shapes, steps or sliders (the empty case)', () => {
    const empty: Scene = { title: null, shapes: {}, steps: [], sliders: [] }
    expect(withinLimits(empty)).toBe(true)
  })

  it('rejects a scene with more than LIMITS.shapes shapes', () => {
    // createSceneBuilder throws before a real scene could ever reach 401
    // shapes (Coverage: `lib.test.ts` already proves that), so the
    // over-the-limit case is built directly as data — exactly the shape
    // `withinLimits` receives from a `postMessage`'d worker result, which
    // is what this check exists to distrust in the first place.
    const dot: Shape = { kind: 'circle', c: [0, 0], r: 0.1, stroke: null, width: 0.04, fill: '#fff' }
    const shapes: Record<string, Shape> = {}
    for (let i = 0; i < LIMITS.shapes + 1; i++) shapes[`s${i}`] = dot
    const scene: Scene = { title: null, shapes, steps: [], sliders: [] }
    expect(withinLimits(scene)).toBe(false)
  })

  it('rejects a scene with more than LIMITS.steps steps', () => {
    const scene: Scene = {
      title: null,
      shapes: {},
      steps: Array.from({ length: LIMITS.steps + 1 }, () => ({ ops: [], duration: 0, caption: null })),
      sliders: [],
    }
    expect(withinLimits(scene)).toBe(false)
  })

  it('rejects a scene with more than LIMITS.sliders sliders', () => {
    const scene: Scene = {
      title: null,
      shapes: {},
      steps: [],
      sliders: Array.from({ length: LIMITS.sliders + 1 }, (_, i) => ({ name: `k${i}`, min: 0, max: 1, value: 0, step: 0.1 })),
    }
    expect(withinLimits(scene)).toBe(false)
  })
})
