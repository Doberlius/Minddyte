import { DIAGRAM_GUIDE } from './guide'
import { LIMITS } from '@/scene/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_CODE = 20_000
const MAX_ERROR = 2000

export type RepairBody = {
  sessionId: string
  messageId: string
  blockIndex: number
  model?: string
} & (
  | { save: false; error: string; previous?: { code: string; error: string } }
  | { save: true; code: string }
)

/** Spec §8. Anything malformed is refused before the workspace or a model is touched. */
export function parseRepairBody(x: unknown): RepairBody | null {
  if (!x || typeof x !== 'object') return null
  const b = x as Record<string, unknown>
  if (typeof b.sessionId !== 'string' || !UUID.test(b.sessionId)) return null
  if (typeof b.messageId !== 'string' || !UUID.test(b.messageId)) return null
  if (!Number.isInteger(b.blockIndex) || (b.blockIndex as number) < 0 || (b.blockIndex as number) >= LIMITS.scenesPerReply) return null
  const model = typeof b.model === 'string' && b.model.length <= 200 ? b.model : undefined
  const base = { sessionId: b.sessionId, messageId: b.messageId, blockIndex: b.blockIndex as number, ...(model ? { model } : {}) }
  if (b.save === true) {
    if (typeof b.code !== 'string' || b.code.length > MAX_CODE) return null
    return { ...base, save: true, code: b.code }
  }
  if (typeof b.error !== 'string') return null
  const p = b.previous as Record<string, unknown> | undefined
  const previous =
    p && typeof p.code === 'string' && typeof p.error === 'string' && p.code.length <= MAX_CODE
      ? { code: p.code, error: p.error.slice(0, MAX_ERROR) }
      : undefined
  return { ...base, save: false, error: b.error.slice(0, MAX_ERROR), ...(previous ? { previous } : {}) }
}

export const REPAIR_SYSTEM = [
  DIAGRAM_GUIDE,
  '',
  'You are fixing a diagram that failed to run. Reply with exactly ONE ```scene block containing the corrected code, and nothing else. Keep what the diagram was trying to show; use only the functions listed above.',
].join('\n')

export function repairPrompt(input: { code: string; error: string; previous?: { code: string; error: string } }): string {
  const parts = ['This scene code failed:', '```scene', input.code, '```', `Error: ${input.error}`]
  if (input.previous) parts.push('', 'An earlier fix also failed:', '```scene', input.previous.code, '```', `Error: ${input.previous.error}`)
  parts.push('', 'Return the corrected scene block.')
  return parts.join('\n')
}
