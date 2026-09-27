import { describe, it, expect } from 'vitest'
import { COLORS, LimitError, createSceneBuilder } from '@/scene/runtime/lib'
import { LIMITS, type Poly, type Label } from '@/scene/types'

const build = (fn: (api: ReturnType<typeof createSceneBuilder>['api']) => void, sliders: Record<string, number> = {}) => {
  const b = createSceneBuilder(sliders)
  fn(b.api)
  return b.finish()
}

describe('axes and plot', () => {
  it('maps maths coordinates into the view and plots inside the y range', () => {
    const scene = build(({ axes, play, create }) => {
      const ax = axes({ x: [-1, 1], y: [-1, 1] })
      expect(ax.toScene([-1, -1])).toEqual([-7, -3.9])
      expect(ax.toScene([1, 1])).toEqual([7, 3.9])
      play(create(ax))
      play(create(ax.plot((x) => x * x, { color: COLORS.BLUE })))
    })
    expect(scene.steps).toHaveLength(2)
    const curveId = (scene.steps[1].ops[0] as { ids: string[] }).ids[0]
    const curve = scene.shapes[curveId] as Poly
    expect(curve.kind).toBe('poly')
    expect(curve.stroke).toBe(COLORS.BLUE)
    expect(curve.points.length).toBeGreaterThan(100)
    expect(curve.points.every(([, y]) => y >= -3.9 - 1e-9 && y <= 3.9 + 1e-9)).toBe(true)
  })

  it('breaks a curve where it leaves the y range (1/x)', () => {
    const scene = build(({ axes, play, create }) => {
      const ax = axes({ x: [-2, 2], y: [-3, 3] })
      play(create(ax.plot((x) => 1 / x)))
    })
    expect((scene.steps[0].ops[0] as { ids: string[] }).ids.length).toBe(2)
  })
})

describe('play, captions, wait', () => {
  it('makes one step per play, carrying the pending caption once', () => {
    const scene = build(({ vector, play, create, caption, wait }) => {
      const v = vector([2, 1])
      caption('The vector')
      play(create(v))
      play(wait(0.5))
    })
    expect(scene.steps.map((s) => s.caption)).toEqual(['The vector', null])
    expect(scene.steps[1]).toEqual({ ops: [], duration: 0.5, caption: null })
  })

  it('treats play(obj) as play(create(obj))', () => {
    const scene = build(({ point, play }) => { play(point([0, 0])) })
    expect(scene.steps[0].ops[0].op).toBe('create')
  })

  it('shows everything at once if the code never calls play', () => {
    const scene = build(({ point }) => { point([0, 0]); point([1, 1]) })
    expect(scene.steps).toHaveLength(1)
    expect((scene.steps[0].ops[0] as { ids: string[] }).ids).toHaveLength(2)
  })

  it('rejects something that is not an animation', () => {
    expect(() => build(({ play }) => { play(42 as never) })).toThrow(/play\(\)/)
  })
})

describe('sliders', () => {
  it('returns the initial value, or the value the viewer chose, clamped', () => {
    const s1 = build(({ slider }) => { expect(slider('k', 1, 5, 2)).toBe(2) })
    expect(s1.sliders).toEqual([{ name: 'k', min: 1, max: 5, value: 2, step: 0.04 }])
    build(({ slider }) => { expect(slider('k', 1, 5, 2)).toBe(4) }, { k: 4 })
    build(({ slider }) => { expect(slider('k', 1, 5, 2)).toBe(5) }, { k: 99 })
  })
})

describe('array', () => {
  it('swaps what is in two slots, and later swaps start from there', () => {
    const scene = build(({ array, play, create }) => {
      const a = array([5, 2, 8])
      play(create(a))
      play(a.swap(0, 1))
      play(a.swap(1, 2))
    })
    const [first, second] = scene.steps[1].ops as { op: 'change'; id: string; to: Label }[]
    expect(first.to.text).toBe('5')
    expect(second.to.text).toBe('2')
    expect(first.to.at[0]).toBeGreaterThan(second.to.at[0]) // 5 moved right, 2 moved left
    const third = scene.steps[2].ops as { op: 'change'; to: Label }[]
    expect(third.map((o) => o.to.text).sort()).toEqual(['5', '8'])
  })

  it('highlights and clears a box', () => {
    const scene = build(({ array, play }) => {
      const a = array([1, 2])
      play(a.highlight(1, COLORS.YELLOW))
      play(a.highlight(1, null))
    })
    const on = scene.steps[0].ops[0] as { to: Poly }
    const off = scene.steps[1].ops[0] as { to: Poly }
    expect(on.to.fill).toBe(`${COLORS.YELLOW}40`)
    expect(off.to.fill).toBeNull()
  })
})

describe('grid.applyMatrix', () => {
  it('moves grid lines and attached vectors by the matrix', () => {
    const scene = build(({ grid, play, create }) => {
      const g = grid({ x: [-1, 1], y: [-1, 1] })
      const v = g.vector([1, 0])
      play(create(g), create(v))
      play(g.applyMatrix([[2, 0], [0, 1]]))
    })
    const changes = scene.steps[1].ops as { op: 'change'; to: Poly }[]
    expect(changes.every((o) => o.op === 'change')).toBe(true)
    const shaft = changes[changes.length - 2].to
    expect(shaft.points[0]).toEqual([0, 0])
    expect(shaft.points[1][0]).toBeGreaterThan(1.5) // the arrow now reaches towards x = 2
  })
})

describe('tree, graph and lanes', () => {
  it('visits a tree node by label', () => {
    const scene = build(({ tree, play, create }) => {
      const t = tree({ label: 'A', children: [{ label: 'B' }, { label: 'C' }] })
      play(create(t))
      play(t.visit('B', COLORS.YELLOW))
    })
    expect(scene.steps[1].ops[0].op).toBe('change')
  })

  it('refuses duplicate tree labels without ids', () => {
    expect(() => build(({ tree }) => { tree({ label: 'A', children: [{ label: 'A' }] }) })).toThrow(/unique/)
  })

  it('sends and consumes messages on lanes', () => {
    const scene = build(({ lanes, play, create }) => {
      const l = lanes(['P0', 'P1'])
      play(create(l))
      play(l.send('m1', 0))
      play(l.send('m2', 0))
      play(l.consume(0))
    })
    expect(scene.steps[1].ops.map((o) => o.op)).toEqual(['create', 'change', 'change'])
    expect(scene.steps[3].ops[0].op).toBe('fadeOut')
  })

  it('names a graph node that does not exist', () => {
    expect(() => build(({ graph, play }) => { const g = graph(['a', 'b'], [['a', 'b']]); play(g.visit('z')) })).toThrow(/z/)
  })
})

describe('limits', () => {
  it(`stops past ${LIMITS.shapes} shapes`, () => {
    expect(() => build(({ point }) => { for (let i = 0; i < LIMITS.shapes + 1; i++) point([0, 0]) })).toThrow(LimitError)
  })
  it(`stops past ${LIMITS.steps} steps`, () => {
    expect(() => build(({ play, wait }) => { for (let i = 0; i < LIMITS.steps + 1; i++) play(wait(0.1)) })).toThrow(/\[limits\]/)
  })
  it(`stops past ${LIMITS.sliders} sliders`, () => {
    expect(() => build(({ slider }) => { for (let i = 0; i <= LIMITS.sliders; i++) slider(`s${i}`, 0, 1, 0) })).toThrow(/\[limits\]/)
  })
})
