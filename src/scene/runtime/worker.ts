/**
 * Runs inside a Blob-URL worker in the sandboxed frame. It exposes the begin/end
 * hooks that wrap the model's code (see wrap.ts). Task 5 installs the library.
 */
const g = self as unknown as Record<string, unknown>
g.__minddyte_begin = (_values: Record<string, number>) => {}
g.__minddyte_end = () => {
  ;(self as unknown as { postMessage(m: unknown): void }).postMessage({ type: 'scene', scene: {} })
}
