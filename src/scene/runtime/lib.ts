/**
 * Minddyte's mini "Manim": the only functions a scene block can call
 * (documented for the model in src/lib/scene/guide.ts — keep names in sync).
 * Everything here only DESCRIBES a scene; nothing draws. Runs in the sandboxed
 * worker, and in node tests.
 */
import { LIMITS, type Label, type Op, type Poly, type Scene, type Shape, type SliderDef, type Step, type Vec } from '../types'

export const COLORS = {
  BLUE: '#58C4DD', TEAL: '#5CD0B3', GREEN: '#83C167', YELLOW: '#FFFF00', GOLD: '#F0AC5F',
  RED: '#FC6255', PURPLE: '#9A72AC', WHITE: '#FFFFFF', GREY: '#888888',
} as const

export const MATH = {
  PI: Math.PI, TAU: 2 * Math.PI, E: Math.E,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, log: Math.log, pow: Math.pow, min: Math.min, max: Math.max,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign, hypot: Math.hypot,
}

/** "[limits]" is how the frame recognises a too-large scene (run.ts classifyWorkerError). */
export class LimitError extends Error {
  constructor(what: string) {
    super(`[limits] ${what}`)
    this.name = 'Error'
  }
}

export type Anim = { ops: Op[]; duration: number }
export type Obj = { ids: string[] }
type Style = { color?: string; width?: number }

const VIEW_X: Vec = [-7, 7]
const VIEW_Y: Vec = [-3.9, 3.9]
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const isAnim = (x: unknown): x is Anim => !!x && typeof x === 'object' && Array.isArray((x as Anim).ops)
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && Array.isArray((x as Obj).ids)

function niceStep(span: number): number {
  const raw = span / 10
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p
}

function arrowShapes(from: Vec, to: Vec, color: string, width = 0.05): [Poly, Poly] {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const len = Math.hypot(dx, dy)
  const [ux, uy] = len < 1e-9 ? [1, 0] : [dx / len, dy / len]
  const head = Math.min(0.3, len * 0.4)
  const base: Vec = [to[0] - ux * head, to[1] - uy * head]
  const w = head * 0.55
  return [
    { kind: 'poly', points: [from, base], closed: false, stroke: color, width, fill: null },
    { kind: 'poly', points: [to, [base[0] - uy * w, base[1] + ux * w], [base[0] + uy * w, base[1] - ux * w]], closed: true, stroke: color, width: 0.01, fill: color },
  ]
}

const square = (c: Vec, s: number): Vec[] => [
  [c[0] - s / 2, c[1] - s / 2], [c[0] + s / 2, c[1] - s / 2], [c[0] + s / 2, c[1] + s / 2], [c[0] - s / 2, c[1] + s / 2],
]
const rect = (x0: number, x1: number, cy: number, h: number): Vec[] => [[x0, cy - h / 2], [x1, cy - h / 2], [x1, cy + h / 2], [x0, cy + h / 2]]

type TreeSpec = { label: string; id?: string; children?: TreeSpec[] }

export function createSceneBuilder(sliderValues: Record<string, number>) {
  const shapes: Record<string, Shape> = {}
  const current: Record<string, Shape> = {} // geometry after every animation described so far
  const steps: Step[] = []
  const sliders: SliderDef[] = []
  let title: string | null = null
  let pendingCaption: string | null = null
  let count = 0

  const add = (s: Shape): string => {
    count += 1
    if (count > LIMITS.shapes) throw new LimitError(`more than ${LIMITS.shapes} shapes`)
    const id = `s${count}`
    shapes[id] = s
    current[id] = s
    return id
  }
  const change = (id: string, patch: Partial<Shape>): Op => {
    const to = { ...current[id], ...patch } as Shape
    current[id] = to
    return { op: 'change', id, to }
  }
  const poly = (points: Vec[], o: { stroke?: string; width?: number; fill?: string | null; closed?: boolean } = {}) =>
    add({ kind: 'poly', points, closed: o.closed ?? false, stroke: o.stroke ?? COLORS.WHITE, width: o.width ?? 0.04, fill: o.fill ?? null })
  const circle = (c: Vec, r: number, o: { stroke?: string | null; fill?: string | null; width?: number } = {}) =>
    add({ kind: 'circle', c, r, stroke: o.stroke === undefined ? COLORS.WHITE : o.stroke, width: o.width ?? 0.04, fill: o.fill ?? null })
  const text = (at: Vec, t: unknown, o: { color?: string; size?: number; tex?: boolean } = {}) =>
    add({ kind: 'label', at, text: String(t), tex: o.tex ?? true, color: o.color ?? COLORS.WHITE, size: o.size ?? 0.4 })
  const arrow = (from: Vec, to: Vec, color: string): string[] => arrowShapes(from, to, color).map(add)

  // ── Shapes ───────────────────────────────────────────────────────────────
  function axes(o: { x?: [number, number]; y?: [number, number]; color?: string } = {}) {
    const [x0, x1] = o.x ?? [-5, 5]
    const [y0, y1] = o.y ?? [-3, 3]
    if (!(x1 > x0 && y1 > y0)) throw new Error('axes: each range must be [min, max] with min < max')
    const sx = (VIEW_X[1] - VIEW_X[0]) / (x1 - x0)
    const sy = (VIEW_Y[1] - VIEW_Y[0]) / (y1 - y0)
    const toScene = ([x, y]: Vec): Vec => [VIEW_X[0] + (x - x0) * sx, VIEW_Y[0] + (y - y0) * sy]
    const color = o.color ?? COLORS.GREY
    const ox = clamp(0, x0, x1)
    const oy = clamp(0, y0, y1)
    const ids = [
      poly([toScene([x0, oy]), toScene([x1, oy])], { stroke: color, width: 0.03 }),
      poly([toScene([ox, y0]), toScene([ox, y1])], { stroke: color, width: 0.03 }),
    ]
    const tx = niceStep(x1 - x0)
    for (let v = Math.ceil(x0 / tx) * tx; v <= x1 + 1e-9; v += tx) {
      if (Math.abs(v - ox) < 1e-9) continue
      const [px, py] = toScene([v, oy])
      ids.push(poly([[px, py - 0.08], [px, py + 0.08]], { stroke: color, width: 0.02 }))
      ids.push(text([px, py - 0.3], +v.toFixed(6), { tex: false, size: 0.26, color }))
    }
    const ty = niceStep(y1 - y0)
    for (let v = Math.ceil(y0 / ty) * ty; v <= y1 + 1e-9; v += ty) {
      if (Math.abs(v - oy) < 1e-9) continue
      const [px, py] = toScene([ox, v])
      ids.push(poly([[px - 0.08, py], [px + 0.08, py]], { stroke: color, width: 0.02 }))
      ids.push(text([px - 0.35, py], +v.toFixed(6), { tex: false, size: 0.26, color }))
    }
    return {
      ids,
      toScene,
      plot(fn: (x: number) => number, po: Style & { samples?: number } = {}): Obj {
        if (typeof fn !== 'function') throw new Error('plot: give a function, like x => sin(x)')
        const n = clamp(Math.round(po.samples ?? 200), 10, 400)
        const segments: Vec[][] = []
        let seg: Vec[] = []
        for (let i = 0; i <= n; i++) {
          const x = x0 + ((x1 - x0) * i) / n
          const y = fn(x)
          if (typeof y === 'number' && Number.isFinite(y) && y >= y0 && y <= y1) seg.push(toScene([x, y]))
          else if (seg.length) { segments.push(seg); seg = [] }
        }
        if (seg.length) segments.push(seg)
        const c = po.color ?? COLORS.BLUE
        return { ids: segments.filter((s) => s.length > 1).map((s) => poly(s, { stroke: c, width: po.width ?? 0.05 })) }
      },
      point: ([x, y]: Vec, po: Style & { r?: number } = {}): Obj => ({ ids: [circle(toScene([x, y]), po.r ?? 0.08, { stroke: null, fill: po.color ?? COLORS.YELLOW })] }),
      vector: ([x, y]: Vec, po: Style = {}): Obj => ({ ids: arrow(toScene([0, 0].map((v, i) => clamp(v, i ? y0 : x0, i ? y1 : x1)) as Vec), toScene([x, y]), po.color ?? COLORS.YELLOW) }),
      label: (t: unknown, [x, y]: Vec, lo: { color?: string; size?: number; tex?: boolean } = {}): Obj => ({ ids: [text(toScene([x, y]), t, lo)] }),
    }
  }

  function grid(o: { x?: [number, number]; y?: [number, number]; color?: string } = {}) {
    const [x0, x1] = o.x ?? [-7, 7]
    const [y0, y1] = o.y ?? [-4, 4]
    const color = o.color ?? COLORS.BLUE
    const lines: { id: string; a: Vec; b: Vec }[] = []
    for (let x = Math.ceil(x0); x <= x1; x++) {
      const a: Vec = [x, y0]; const b: Vec = [x, y1]
      lines.push({ id: poly([a, b], { stroke: x === 0 ? COLORS.WHITE : color, width: x === 0 ? 0.04 : 0.02 }), a, b })
    }
    for (let y = Math.ceil(y0); y <= y1; y++) {
      const a: Vec = [x0, y]; const b: Vec = [x1, y]
      lines.push({ id: poly([a, b], { stroke: y === 0 ? COLORS.WHITE : color, width: y === 0 ? 0.04 : 0.02 }), a, b })
    }
    const vectors: { ids: string[]; v: Vec; color: string }[] = []
    return {
      ids: lines.map((l) => l.id),
      vector(v: Vec, vo: Style = {}): Obj {
        const c = vo.color ?? COLORS.YELLOW
        const ids = arrow([0, 0], v, c)
        vectors.push({ ids, v, color: c })
        return { ids }
      },
      applyMatrix(m: [[number, number], [number, number]]): Anim {
        const ok = Array.isArray(m) && m.length === 2 && m.every((r) => Array.isArray(r) && r.length === 2 && r.every((n) => Number.isFinite(n)))
        if (!ok) throw new Error('applyMatrix: give [[a, b], [c, d]] with numbers')
        const apply = ([x, y]: Vec): Vec => [m[0][0] * x + m[0][1] * y, m[1][0] * x + m[1][1] * y]
        const ops: Op[] = []
        for (const l of lines) {
          l.a = apply(l.a); l.b = apply(l.b)
          ops.push(change(l.id, { points: [l.a, l.b] } as Partial<Poly>))
        }
        for (const vec of vectors) {
          vec.v = apply(vec.v)
          const [shaft, tip] = arrowShapes([0, 0], vec.v, vec.color)
          ops.push(change(vec.ids[0], shaft), change(vec.ids[1], tip))
        }
        return { ops, duration: 1.5 }
      },
    }
  }

  function array(values: unknown[], o: { at?: Vec; color?: string } = {}) {
    if (!Array.isArray(values) || values.length === 0) throw new Error('array: give at least one value')
    const n = values.length
    const size = Math.min(1, 13 / n)
    const [cx, cy] = o.at ?? [0, 0]
    const left = cx - (n * size) / 2
    const slot = (i: number): Vec => [left + size * (i + 0.5), cy]
    const color = o.color ?? COLORS.BLUE
    const boxes = values.map((_, i) => poly(square(slot(i), size * 0.92), { stroke: color, width: 0.03, closed: true }))
    const labels = values.map((v, i) => text(slot(i), v, { tex: false, size: 0.42 * size }))
    const order = labels.slice() // order[i] = the label currently in slot i
    const check = (i: number) => {
      if (!Number.isInteger(i) || i < 0 || i >= n) throw new Error(`array: index ${i} is outside 0..${n - 1}`)
    }
    return {
      ids: [...boxes, ...labels],
      swap(i: number, j: number): Anim {
        check(i); check(j)
        const a = order[i]; const b = order[j]
        order[i] = b; order[j] = a
        return { ops: [change(a, { at: slot(j) } as Partial<Label>), change(b, { at: slot(i) } as Partial<Label>)], duration: 0.8 }
      },
      highlight(i: number, c: string | null = COLORS.YELLOW): Anim {
        check(i)
        return { ops: [change(boxes[i], { fill: c ? `${c}40` : null, stroke: c ?? color } as Partial<Poly>)], duration: 0.4 }
      },
      set(i: number, v: unknown): Anim {
        check(i)
        return { ops: [change(order[i], { text: String(v) } as Partial<Label>)], duration: 0.5 }
      },
    }
  }

  function network(nodes: { id: string; label: string; at: Vec }[], edges: [string, string][], color: string) {
    const r = 0.36
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const find = (name: string) => {
      const node = byId.get(String(name))
      if (!node) throw new Error(`no node named "${name}"`)
      return node
    }
    const edgeIds = new Map<string, string>()
    for (const [a, b] of edges) {
      const pa = find(a).at; const pb = find(b).at
      const d = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1
      const off = (p: Vec, q: Vec): Vec => [p[0] + ((q[0] - p[0]) / d) * r, p[1] + ((q[1] - p[1]) / d) * r]
      edgeIds.set(`${a}\u0000${b}`, poly([off(pa, pb), off(pb, pa)], { stroke: COLORS.GREY, width: 0.03 }))
    }
    const circles = new Map(nodes.map((n) => [n.id, circle(n.at, r, { stroke: color, fill: '#0E0E10', width: 0.04 })]))
    const labels = nodes.map((n) => text(n.at, n.label, { tex: false, size: 0.3 }))
    return {
      ids: [...edgeIds.values(), ...circles.values(), ...labels],
      visit(name: string, c: string = COLORS.YELLOW): Anim {
        const id = circles.get(find(name).id)!
        return { ops: [change(id, { fill: `${c}55`, stroke: c })], duration: 0.5 }
      },
      edge(a: string, b: string, c: string = COLORS.YELLOW): Anim {
        const id = edgeIds.get(`${a}\u0000${b}`) ?? edgeIds.get(`${b}\u0000${a}`)
        if (!id) throw new Error(`no edge between "${a}" and "${b}"`)
        return { ops: [change(id, { stroke: c, width: 0.06 } as Partial<Poly>)], duration: 0.5 }
      },
    }
  }

  function graph(nodeList: (string | { id: string; label?: string })[], edges: [string, string][] = [], o: { at?: Vec; color?: string } = {}) {
    if (!Array.isArray(nodeList) || nodeList.length === 0) throw new Error('graph: give at least one node')
    const [cx, cy] = o.at ?? [0, 0]
    const radius = Math.min(3.4, 0.9 + nodeList.length * 0.35)
    const nodes = nodeList.map((n, i) => {
      const id = typeof n === 'string' ? n : n.id
      const a = Math.PI / 2 - (i * 2 * Math.PI) / nodeList.length
      return { id: String(id), label: typeof n === 'string' ? n : n.label ?? n.id, at: [cx + radius * Math.cos(a), cy + radius * Math.sin(a)] as Vec }
    })
    if (new Set(nodes.map((n) => n.id)).size !== nodes.length) throw new Error('graph: node ids must be unique')
    return network(nodes, edges, o.color ?? COLORS.BLUE)
  }

  function tree(spec: TreeSpec, o: { color?: string } = {}) {
    const nodes: { id: string; label: string; depth: number; x: number }[] = []
    const edges: [string, string][] = []
    let leaf = 0
    const walk = (s: TreeSpec, depth: number): number => {
      if (!s || typeof s.label !== 'string') throw new Error('tree: every node needs a label')
      const id = s.id ?? s.label
      const kids = s.children ?? []
      let x: number
      if (kids.length === 0) x = leaf++
      else {
        const xs = kids.map((k) => { edges.push([id, k.id ?? k.label]); return walk(k, depth + 1) })
        x = (xs[0] + xs[xs.length - 1]) / 2
      }
      nodes.push({ id, label: s.label, depth, x })
      return x
    }
    walk(spec, 0)
    if (new Set(nodes.map((n) => n.id)).size !== nodes.length) throw new Error('tree: node labels must be unique, or give each an id')
    const maxDepth = Math.max(...nodes.map((n) => n.depth))
    const dy = maxDepth === 0 ? 0 : Math.min(1.5, 7 / maxDepth)
    const spread = Math.max(1, leaf - 1)
    const placed = nodes.map((n) => ({ id: n.id, label: n.label, at: [leaf === 1 ? 0 : -6.5 + (13 * n.x) / spread, 3.4 - n.depth * dy] as Vec }))
    return network(placed, edges, o.color ?? COLORS.BLUE)
  }

  function lanes(names: string[], o: { color?: string } = {}) {
    if (!Array.isArray(names) || names.length === 0) throw new Error('lanes: give at least one lane name')
    const n = names.length
    const h = Math.min(1, 6.5 / n)
    const gap = h * 0.3
    const top = (n * h + (n - 1) * gap) / 2
    const laneY = (i: number) => top - h / 2 - i * (h + gap)
    const color = o.color ?? COLORS.GREY
    const ids: string[] = []
    names.forEach((name, i) => {
      ids.push(poly(rect(-4.2, 6.8, laneY(i), h), { stroke: color, width: 0.03, closed: true }))
      ids.push(text([-5.6, laneY(i)], name, { tex: false, size: 0.34 }))
    })
    const chipW = 0.9
    const slotX = (k: number) => -3.7 + k * (chipW + 0.15)
    const queues: [string, string][][] = names.map(() => [])
    const check = (i: number) => {
      if (!Number.isInteger(i) || i < 0 || i >= n) throw new Error(`lanes: lane ${i} is outside 0..${n - 1}`)
    }
    return {
      ids,
      send(label: unknown, lane: number, c: string = COLORS.BLUE): Anim {
        check(lane)
        const y = laneY(lane)
        const box = poly(rect(-7.9, -7.9 + chipW, y, h * 0.7), { stroke: c, fill: `${c}33`, width: 0.03, closed: true })
        const lab = text([-7.9 + chipW / 2, y], label, { tex: false, size: 0.28 })
        const k = queues[lane].length
        queues[lane].push([box, lab])
        const x = slotX(k)
        return {
          ops: [{ op: 'create', ids: [box, lab] }, change(box, { points: rect(x, x + chipW, y, h * 0.7) } as Partial<Poly>), change(lab, { at: [x + chipW / 2, y] } as Partial<Label>)],
          duration: 1,
        }
      },
      consume(lane: number): Anim {
        check(lane)
        const q = queues[lane]
        if (q.length === 0) throw new Error(`lanes: lane ${lane} is empty`)
        const [gone, ...rest] = q
        queues[lane] = rest
        const y = laneY(lane)
        const ops: Op[] = [{ op: 'fadeOut', ids: gone }]
        rest.forEach(([box, lab], k) => {
          const x = slotX(k)
          ops.push(change(box, { points: rect(x, x + chipW, y, h * 0.7) } as Partial<Poly>), change(lab, { at: [x + chipW / 2, y] } as Partial<Label>))
        })
        return { ops, duration: 0.8 }
      },
    }
  }

  const vector = (v: Vec, o: Style = {}): Obj => ({ ids: arrow([0, 0], v, o.color ?? COLORS.YELLOW) })
  const point = (at: Vec, o: Style & { r?: number } = {}): Obj => ({ ids: [circle(at, o.r ?? 0.08, { stroke: null, fill: o.color ?? COLORS.YELLOW })] })
  const label = (t: unknown, at: Vec, o: { color?: string; size?: number; tex?: boolean } = {}): Obj => ({ ids: [text(at, t, o)] })

  // ── Motion ───────────────────────────────────────────────────────────────
  const idsOf = (x: Obj | Obj[]): string[] => {
    const list = Array.isArray(x) ? x : [x]
    if (!list.every(isObj)) throw new Error('expected a shape, like the result of axes() or ax.plot(...)')
    return list.flatMap((o) => o.ids)
  }
  const create = (x: Obj | Obj[], o: { duration?: number } = {}): Anim => ({ ops: [{ op: 'create', ids: idsOf(x) }], duration: o.duration ?? 1 })
  const fadeOut = (x: Obj | Obj[], o: { duration?: number } = {}): Anim => ({ ops: [{ op: 'fadeOut', ids: idsOf(x) }], duration: o.duration ?? 0.6 })
  const translate = (s: Shape, [dx, dy]: Vec): Partial<Shape> =>
    s.kind === 'poly' ? { points: s.points.map(([x, y]) => [x + dx, y + dy] as Vec) }
      : s.kind === 'circle' ? { c: [s.c[0] + dx, s.c[1] + dy] }
        : { at: [s.at[0] + dx, s.at[1] + dy] }
  const move = (x: Obj | Obj[], by: Vec, o: { duration?: number } = {}): Anim => ({
    ops: idsOf(x).map((id) => change(id, translate(current[id], by))),
    duration: o.duration ?? 1,
  })
  const transform = (a: Obj, b: Obj, o: { duration?: number } = {}): Anim => {
    const from = idsOf(a); const to = idsOf(b)
    const n = Math.max(from.length, to.length)
    const changes: Op[] = []
    const fadeIds: string[] = []
    const cloneIds: string[] = []
    for (let i = 0; i < n; i++) {
      const fid = from[i]
      const tid = to[i]
      if (fid !== undefined && tid !== undefined && current[fid].kind === current[tid].kind) {
        changes.push(change(fid, current[tid]))
        continue
      }
      if (fid !== undefined) fadeIds.push(fid)
      if (tid !== undefined) cloneIds.push(add({ ...current[tid] }))
    }
    if (cloneIds.length) a.ids.push(...cloneIds) // so a later move/fadeOut/transform on `a` reaches them too
    const ops: Op[] = [...changes]
    if (fadeIds.length) ops.push({ op: 'fadeOut', ids: fadeIds })
    if (cloneIds.length) ops.push({ op: 'create', ids: cloneIds })
    return { ops, duration: o.duration ?? 1.2 }
  }
  const wait = (seconds = 1): Anim => ({ ops: [], duration: clamp(Number(seconds) || 0, 0, 10) })

  function play(...items: (Anim | Obj)[]) {
    if (items.length === 0) throw new Error('play() needs at least one animation')
    const anims = items.map((x) => {
      if (isAnim(x)) return x
      if (isObj(x)) return create(x)
      throw new Error('play() takes animations like create(x) or a.swap(0, 1)')
    })
    if (steps.length >= LIMITS.steps) throw new LimitError(`more than ${LIMITS.steps} steps`)
    steps.push({ ops: anims.flatMap((a) => a.ops), duration: Math.max(...anims.map((a) => a.duration)), caption: pendingCaption })
    pendingCaption = null
  }

  function slider(name: string, min: number, max: number, initial: number, step?: number): number {
    if (sliders.length >= LIMITS.sliders) throw new LimitError(`more than ${LIMITS.sliders} sliders`)
    if (!(Number.isFinite(min) && Number.isFinite(max) && max > min)) throw new Error(`slider "${name}": needs min < max`)
    const s = step && step > 0 ? step : +((max - min) / 100).toFixed(6)
    const chosen = sliderValues[String(name)]
    if (!Number.isFinite(chosen) && !Number.isFinite(Number(initial))) throw new Error(`slider "${name}": initial must be a number between min and max`)
    const value = clamp(Number.isFinite(chosen) ? chosen : Number(initial), min, max)
    sliders.push({ name: String(name), min, max, value, step: s })
    return value
  }

  const api = {
    axes, grid, vector, point, label, array, graph, tree, lanes,
    create, fadeOut, move, transform, wait, play, slider,
    caption: (t: unknown) => { pendingCaption = String(t) },
    title: (t: unknown) => { title = String(t) },
  }

  function finish(): Scene {
    if (steps.length === 0 && count > 0) steps.push({ ops: [{ op: 'create', ids: Object.keys(shapes) }], duration: 1, caption: pendingCaption })
    return { title, shapes, steps, sliders }
  }

  return { api, finish }
}
