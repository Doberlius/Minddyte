import { LIMITS, type Scene } from '../types'

/**
 * Defense in depth for `frame.ts`'s `show()`: `createSceneBuilder` (lib.ts)
 * already enforces LIMITS.shapes/steps/sliders while the worker BUILDS a
 * scene, but the frame trusts whatever `postMessage`'d back as
 * `{ type: 'scene', scene }` without looking at it again — and `scene`
 * crosses from the worker to the frame as plain, structurally-cloned data,
 * not a value the frame constructed itself. Re-checking it here, right
 * before `show()` touches the DOM, is what turns an over-large scene into a
 * clean `limits` error instead of a slow or broken render.
 *
 * Pulled into its own module (no DOM/worker side effects) so it can be
 * imported and unit-tested directly — `frame.ts` runs `init()` at import
 * time based on `document.body`, which a plain Node test has no use of.
 *
 * There is NO check on the total number of `create`/`change` op id
 * references across all steps. There used to be one (bounded by
 * `LIMITS.shapes`), but `lib.ts`'s `move()`/`transform()`/`lanes().consume`
 * each emit one `change` op per id, every time they are called, completely
 * unbounded by `createSceneBuilder` — a perfectly ordinary small diagram
 * (an axes + one dot, moved a dozen times) measured at 35 shapes / 13 steps
 * but 455 op-id references, well past `LIMITS.shapes` on that count alone,
 * and got rejected as "too large" despite being nowhere near the real
 * limits. Op ids are not a resource `LIMITS` was ever meant to bound.
 */
export function withinLimits(s: Scene): boolean {
  if (Object.keys(s.shapes).length > LIMITS.shapes) return false
  if (s.steps.length > LIMITS.steps) return false
  if (s.sliders.length > LIMITS.sliders) return false
  return true
}
