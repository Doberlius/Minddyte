/**
 * Messages between the page (ScenePlayer), the sandboxed frame and its worker.
 * The frame is sealed; these few shapes are all that crosses its edge.
 *
 *   page  -> frame   render: the scene code, and whether to autoplay
 *   frame -> page    ready (loaded), height, error, done (first draw succeeded)
 */
export const WORKER_TIMEOUT_MS = 2000

export type FrameErrorKind = 'error' | 'timeout' | 'limits' | 'unsupported'

export type ToFrame = { type: 'render'; code: string; autoplay: boolean }

export type FromFrame =
  | { type: 'ready' }
  | { type: 'height'; px: number }
  | { type: 'error'; kind: FrameErrorKind; message: string }
  | { type: 'done' }

const KINDS: readonly FrameErrorKind[] = ['error', 'timeout', 'limits', 'unsupported']

export function isFromFrame(x: unknown): x is FromFrame {
  if (!x || typeof x !== 'object') return false
  const m = x as Record<string, unknown>
  switch (m.type) {
    case 'ready':
    case 'done':
      return true
    case 'height':
      return typeof m.px === 'number' && Number.isFinite(m.px)
    case 'error':
      return typeof m.message === 'string' && KINDS.includes(m.kind as FrameErrorKind)
    default:
      return false
  }
}

/** A message counts only if it came from THIS player's frame and has a known shape. */
export function acceptFrameMessage(ev: { source: unknown; data: unknown }, frameWindow: unknown): FromFrame | null {
  if (!frameWindow || ev.source !== frameWindow) return null
  return isFromFrame(ev.data) ? ev.data : null
}

/** Spec §8: automatic repair only for a reply that arrived in this page view, at most twice. */
export function shouldAutoRepair(s: { fresh: boolean; attempts: number; kind: FrameErrorKind; canRepair: boolean }): boolean {
  return s.canRepair && s.fresh && s.kind !== 'unsupported' && s.attempts < 2
}
