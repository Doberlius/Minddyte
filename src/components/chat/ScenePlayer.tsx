'use client'

import { useContext, useEffect, useRef, useState } from 'react'
import { buildFrameDoc } from '@/scene/frameDoc'
import { acceptFrameMessage, shouldAutoRepair, type FrameErrorKind } from '@/scene/runtime/protocol'
import { SceneContext } from './SceneContext'
import { CodeBlock } from './CodeBlock'

/**
 * One diagram in a reply (spec §6): a sealed frame (sandbox="allow-scripts",
 * never allow-same-origin) that runs the scene code, plus a Code toggle and
 * the failure card. The frame is created only after mount, because its
 * document names this page's origin.
 */
type Phase =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'failed'; error: { kind: FrameErrorKind; message: string } }

const READY_TIMEOUT_MS = 10_000

export const FAILURE_TITLE: Record<FrameErrorKind, string> = {
  error: 'Couldn’t draw this diagram',
  timeout: 'This diagram took too long',
  limits: 'This diagram is too large to draw',
  unsupported: 'Diagrams aren’t supported in this browser',
}

export function ScenePlayer({ code, index }: { code: string; index: number }) {
  const ctx = useContext(SceneContext)
  const frame = useRef<HTMLIFrameElement>(null)
  const [doc, setDoc] = useState<string | null>(null)
  const [height, setHeight] = useState(420)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [showCode, setShowCode] = useState(false)

  // The code actually running in the frame. It starts as the reply's own
  // text but becomes a repaired version once one runs — frameKey remounts
  // the iframe (a fresh document, not a message telling the old one to
  // re-render) so a run that left the worker/runtime in a bad state never
  // lingers into the next attempt.
  const [current, setCurrent] = useState(code)
  const [frameKey, setFrameKey] = useState(0)
  const [repairing, setRepairing] = useState(false)
  const attempts = useRef(0)
  const lastFailure = useRef<{ code: string; error: string } | null>(null)
  // Set only while a repaired run's success has not yet been persisted, so
  // the 'done' handler below knows there is something worth saving.
  const unsaved = useRef<string | null>(null)
  // Spec §8: repair needs to know which message and which block to load the
  // failing code from — an old chat reopened without that context never
  // qualifies, automatically or via Try again.
  const canRepair = !!(ctx.sessionId && ctx.messageId)

  useEffect(() => {
    setDoc(buildFrameDoc(window.location.origin))
  }, [])

  /** Ask the server to fix `lastFailure`'s code, then run what it returns. */
  async function repair() {
    const failure = lastFailure.current
    if (!failure || !ctx.sessionId || !ctx.messageId) return
    attempts.current += 1
    setRepairing(true)
    try {
      const res = await fetch('/api/scene/repair', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: ctx.sessionId, messageId: ctx.messageId, blockIndex: index, error: failure.error,
          // Attempt 2 shows the model what attempt 1 tried (Decision 3).
          ...(failure.code !== code ? { previous: failure } : {}),
          ...(ctx.model ? { model: ctx.model } : {}),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { code?: string; error?: string }
      if (!res.ok || !data.code) throw new Error(data.error ?? `HTTP ${res.status}`)
      unsaved.current = data.code
      setCurrent(data.code)
      setPhase({ kind: 'loading' })
      setFrameKey((k) => k + 1)
    } catch (e) {
      setPhase({ kind: 'failed', error: { kind: 'error', message: `${failure.error} (repair failed: ${String(e instanceof Error ? e.message : e)})` } })
    } finally {
      setRepairing(false)
    }
  }

  useEffect(() => {
    if (!doc) return
    let ready = false
    const onMessage = (ev: MessageEvent) => {
      const msg = acceptFrameMessage(ev, frame.current?.contentWindow ?? null)
      if (!msg) return
      if (msg.type === 'ready') {
        ready = true
        frame.current?.contentWindow?.postMessage({ type: 'render', code: current, autoplay: ctx.fresh }, '*')
      } else if (msg.type === 'height') setHeight(msg.px)
      else if (msg.type === 'done') {
        setPhase({ kind: 'ready' })
        // A repaired run that just succeeded — save it so a reopened chat
        // shows the working version too (spec §8).
        const fixed = unsaved.current
        unsaved.current = null
        if (fixed && ctx.sessionId && ctx.messageId) {
          void fetch('/api/scene/repair', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: ctx.sessionId, messageId: ctx.messageId, blockIndex: index, save: true, code: fixed }),
          })
        }
      } else if (msg.type === 'error') {
        lastFailure.current = { code: current, error: msg.message }
        if (shouldAutoRepair({ fresh: ctx.fresh, attempts: attempts.current, kind: msg.kind, canRepair })) void repair()
        else setPhase({ kind: 'failed', error: { kind: msg.kind, message: msg.message } })
      }
    }
    window.addEventListener('message', onMessage)
    const timer = setTimeout(() => {
      if (!ready) setPhase({ kind: 'failed', error: { kind: 'unsupported', message: 'The diagram frame did not start.' } })
    }, READY_TIMEOUT_MS)
    return () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- repair()/canRepair close over refs and ctx already covered by ctx.fresh/ctx.sessionId/ctx.messageId not changing per-render
  }, [doc, current, frameKey, ctx.fresh])

  const failed = phase.kind === 'failed' ? phase.error : null
  return (
    <div className="scene-card" data-scene-index={index}>
      {doc ? (
        <iframe
          key={frameKey}
          ref={frame}
          className="scene-frame"
          title="Interactive diagram"
          sandbox="allow-scripts"
          srcDoc={doc}
          style={{ height, display: failed || repairing ? 'none' : undefined }}
        />
      ) : (
        <div className="scene-status">Loading diagram…</div>
      )}
      {repairing && (
        <div className="scene-status" role="status">Fixing this diagram…</div>
      )}
      {failed && (
        <div className="scene-error" role="alert">
          <strong>{FAILURE_TITLE[failed.kind]}</strong>
          <p>{failed.message}</p>
          {canRepair && failed.kind !== 'unsupported' && (
            <button type="button" onClick={() => void repair()} disabled={repairing}>Try again</button>
          )}
        </div>
      )}
      <div className="scene-foot">
        <button type="button" className="scene-code-toggle" aria-expanded={showCode || !!failed} onClick={() => setShowCode((v) => !v)}>
          {showCode ? 'Hide code' : 'Code'}
        </button>
      </div>
      {(showCode || failed) && (
        <CodeBlock language="scene" code={current}>
          <code>{current}</code>
        </CodeBlock>
      )}
    </div>
  )
}
