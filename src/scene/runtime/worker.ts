/**
 * Runs inside a Blob-URL worker in the sandboxed frame. The model's code sits
 * between begin and end (wrap.ts) and sees exactly the library's globals.
 */
import { COLORS, MATH, createSceneBuilder } from './lib'

type Builder = ReturnType<typeof createSceneBuilder>
const g = self as unknown as Record<string, unknown> & { postMessage(m: unknown): void }
let builder: Builder | null = null

g.__minddyte_begin = (values: Record<string, number>) => {
  builder = createSceneBuilder(values ?? {})
  Object.assign(g, MATH, COLORS, builder.api)
}
g.__minddyte_end = () => {
  if (!builder) throw new Error('the scene never started')
  g.postMessage({ type: 'scene', scene: builder.finish() })
}
