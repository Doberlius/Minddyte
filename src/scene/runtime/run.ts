import { WORKER_TIMEOUT_MS, type FrameErrorKind } from './protocol'
import { workerScript } from './wrap'

/** Injected by scripts/build-scene.mjs: the bundled worker library. */
declare const __WORKER_SOURCE__: string

export type RunResult =
  | { ok: true; scene: unknown }
  | { ok: false; kind: FrameErrorKind; message: string }

/** "Uncaught Error: [limits] …" → the limits kind with a readable sentence. */
export function classifyWorkerError(raw: string): { kind: 'error' | 'limits'; message: string } {
  const message = raw.replace(/^Uncaught\s+/, '')
  const at = message.indexOf('[limits]')
  if (at >= 0) return { kind: 'limits', message: `This diagram is too large: ${message.slice(at + 8).trim()}` }
  return { kind: 'error', message }
}

/**
 * Runs scene code in a fresh Blob-URL worker. The worker only DESCRIBES the
 * scene; a run that has not answered within WORKER_TIMEOUT_MS is terminated,
 * so an infinite loop can never freeze the tab.
 */
export function runScene(code: string, sliders: Record<string, number>): Promise<RunResult> {
  return new Promise((resolve) => {
    let worker: Worker
    let url = ''
    try {
      url = URL.createObjectURL(new Blob([workerScript(__WORKER_SOURCE__, code, sliders)], { type: 'text/javascript' }))
      worker = new Worker(url)
    } catch (e) {
      if (url) URL.revokeObjectURL(url)
      resolve({ ok: false, kind: 'unsupported', message: `This browser cannot run diagrams (${String(e)}).` })
      return
    }
    const finish = (result: RunResult) => {
      clearTimeout(timer)
      worker.terminate()
      URL.revokeObjectURL(url)
      resolve(result)
    }
    const timer = setTimeout(
      () => finish({ ok: false, kind: 'timeout', message: `The diagram code did not finish within ${WORKER_TIMEOUT_MS / 1000} seconds.` }),
      WORKER_TIMEOUT_MS,
    )
    worker.onmessage = (ev: MessageEvent) => {
      const d = ev.data as { type?: string; scene?: unknown }
      if (d?.type === 'scene') finish({ ok: true, scene: d.scene })
      else finish({ ok: false, kind: 'error', message: 'The diagram code sent something unexpected.' })
    }
    worker.onerror = (ev: ErrorEvent) => {
      ev.preventDefault()
      finish({ ok: false, ...classifyWorkerError(ev.message || 'The diagram code failed.') })
    }
  })
}
