/**
 * What a scene looks like at time t: pure, so it is tested in node and the
 * frame only has to paint it. Steps run one after another; within a step every
 * op shares one eased progress p.
 */
import type { Scene, Shape, Vec } from '../types'

export type Visual = { shape: Shape; opacity: number; draw: number }

/** Manim-like ease-in-out. */
export const smooth = (p: number): number => (p <= 0 ? 0 : p >= 1 ? 1 : p * p * (3 - 2 * p))

const lerp = (a: number, b: number, p: number) => a + (b - a) * p
const lerpVec = (a: Vec, b: Vec, p: number): Vec => [lerp(a[0], b[0], p), lerp(a[1], b[1], p)]

function resample(points: Vec[], n: number): Vec[] {
  if (points.length === n) return points
  if (points.length === 0) return Array.from({ length: n }, () => [0, 0] as Vec)
  if (points.length === 1) return Array.from({ length: n }, () => points[0])
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * (points.length - 1)
    const k = Math.floor(t)
    return lerpVec(points[k], points[Math.min(k + 1, points.length - 1)], t - k)
  })
}

export function lerpShape(a: Shape, b: Shape, p: number): Shape {
  if (p <= 0) return a
  if (p >= 1) return b
  if (a.kind !== b.kind) return p < 0.5 ? a : b
  const late = p >= 0.5
  if (a.kind === 'poly' && b.kind === 'poly') {
    const n = Math.max(a.points.length, b.points.length, 2)
    const pa = resample(a.points, n)
    const pb = resample(b.points, n)
    return { ...(late ? b : a), points: pa.map((q, i) => lerpVec(q, pb[i], p)), width: lerp(a.width, b.width, p) }
  }
  if (a.kind === 'circle' && b.kind === 'circle') {
    return { ...(late ? b : a), c: lerpVec(a.c, b.c, p), r: lerp(a.r, b.r, p), width: lerp(a.width, b.width, p) }
  }
  if (a.kind === 'label' && b.kind === 'label') {
    return { ...(late ? b : a), at: lerpVec(a.at, b.at, p), size: lerp(a.size, b.size, p) }
  }
  return late ? b : a
}

export const totalDuration = (scene: Scene): number => scene.steps.reduce((s, st) => s + Math.max(0, st.duration), 0)

export function frameAt(scene: Scene, t: number): Map<string, Visual> {
  const geo = new Map<string, Shape>(Object.entries(scene.shapes))
  const vis = new Map<string, Visual>()
  let start = 0
  for (const step of scene.steps) {
    if (t < start) break
    const d = Math.max(0, step.duration)
    const p = d === 0 ? 1 : smooth(Math.min(1, (t - start) / d))
    for (const op of step.ops) {
      if (op.op === 'create') {
        for (const id of op.ids) {
          const s = geo.get(id)
          if (!s) continue
          const traced = s.kind === 'poly' && !s.fill
          vis.set(id, { shape: s, opacity: traced ? 1 : p, draw: s.kind === 'poly' ? p : 1 })
        }
      } else if (op.op === 'fadeOut') {
        for (const id of op.ids) {
          const v = vis.get(id)
          if (!v) continue
          if (p >= 1) vis.delete(id)
          else vis.set(id, { ...v, opacity: v.opacity * (1 - p) })
        }
      } else {
        const from = geo.get(op.id)
        if (!from) continue
        const s = lerpShape(from, op.to, p)
        geo.set(op.id, p >= 1 ? op.to : s)
        const v = vis.get(op.id)
        if (v) vis.set(op.id, { ...v, shape: s })
      }
    }
    if (t < start + d) break
    start += d
  }
  return vis
}

export function captionAt(scene: Scene, t: number): string | null {
  let caption: string | null = null
  let start = 0
  for (const step of scene.steps) {
    if (t < start) break
    if (step.caption) caption = step.caption
    start += Math.max(0, step.duration)
  }
  return caption
}
