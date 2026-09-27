import { runScene } from './run'
import type { FromFrame, ToFrame } from './protocol'

function post(m: FromFrame) {
  window.parent.postMessage(m, '*')
}

window.addEventListener('message', async (ev: MessageEvent) => {
  if (ev.source !== window.parent) return
  const m = ev.data as ToFrame
  if (m?.type !== 'render' || typeof m.code !== 'string') return
  const r = await runScene(m.code, {})
  post(r.ok ? { type: 'done' } : { type: 'error', kind: r.kind, message: r.message })
})

if (typeof Worker === 'undefined') post({ type: 'error', kind: 'unsupported', message: 'This browser cannot run diagrams.' })
else post({ type: 'ready' })
