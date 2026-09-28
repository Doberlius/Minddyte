'use client'

import { useContext, useEffect, useRef, useState } from 'react'
import { buildFrameDoc } from '@/scene/frameDoc'
import { acceptFrameMessage, repairAction, shouldAutoRepair, type FrameErrorKind } from '@/scene/runtime/protocol'
import { withNotFoundRetry, type RepairAttempt } from '@/lib/scene/repair'
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
// The frame reports its own scrollHeight (frame.ts's ResizeObserver), which
// a pathological or hostile scene (many sliders, a long caption, a huge
// title) could inflate far past anything a chat reply should take up on
// screen. Clamped here, on the page side, rather than trusted from the
// sandboxed frame.
const MAX_HEIGHT_PX = 1600
// The assistant message reaches the database only after its stream ends
// (the chat route's onFinish). A block that fails fast can call repair
// before that write lands, which answers 404 not_found — retried rather
// than counted as a failed attempt, since the code never actually ran
// against the model.
const NOT_FOUND_RETRIES = 3
const NOT_FOUND_DELAY_MS = 1000

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
  // The error from the run of the ORIGINAL `code` (set the first time it
  // fails, never overwritten after). The server always loads `code` — the
  // original, from the database — never `current`, so once a repaired
  // attempt itself fails, the error to send alongside `code` is this one,
  // not the repaired attempt's own error (that one describes `previous`).
  const firstError = useRef<string | null>(null)
  // Set only while a repaired run's success has not yet been persisted, so
  // the 'done' handler below knows there is something worth saving.
  const unsaved = useRef<string | null>(null)
  // An auto-repair that is eligible but arrived while the reply was still
  // streaming (spec §8 + the streaming race fix): held here until the
  // ctx.streaming effect below sees streaming end, rather than spent on a
  // request that would 404 because the message is not saved yet.
  const pendingRepair = useRef(false)
  // The message-listener effect below must NOT re-subscribe when streaming
  // ends — doing that would reset its local `ready` flag and arm a fresh
  // READY_TIMEOUT_MS timer against an iframe that is not being remounted
  // (frameKey does not change just because streaming stopped), which would
  // wrongly fail an already-working diagram 10s later. A ref lets the error
  // handler read the current value without being a dependency.
  const streamingRef = useRef(ctx.streaming)
  useEffect(() => {
    streamingRef.current = ctx.streaming
  }, [ctx.streaming])
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
      const attempt = async (): Promise<RepairAttempt> => {
        const res = await fetch('/api/scene/repair', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId: ctx.sessionId, messageId: ctx.messageId, blockIndex: index,
            // The server always loads `code` (the original) from the database,
            // never `current` — so the `error` sent here must describe THAT
            // code, not whatever last ran. `failure.code !== code` means the
            // failing run was itself a repaired attempt: its own error belongs
            // in `previous` (Decision 3 — attempt 2 shows the model what
            // attempt 1 tried), and `error` falls back to the original
            // failure's message.
            ...(failure.code !== code
              ? { error: firstError.current ?? failure.error, previous: failure }
              : { error: failure.error }),
            ...(ctx.model ? { model: ctx.model } : {}),
          }),
        })
        const data = (await res.json().catch(() => ({}))) as { code?: string; error?: string }
        return { ok: res.ok, status: res.status, data }
      }
      // A 404 not_found here means the assistant message has not reached the
      // database yet, not that the block does not exist — retried rather
      // than treated as a failed run.
      const { ok, status, data } = await withNotFoundRetry(attempt, NOT_FOUND_RETRIES, NOT_FOUND_DELAY_MS)
      if (!ok || !data.code) throw new Error(data.error ?? `HTTP ${status}`)
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

  // Starts a repair that was held back because the reply was still
  // streaming (spec §8 + the streaming race fix), the moment it stops.
  useEffect(() => {
    if (!ctx.streaming && pendingRepair.current) {
      pendingRepair.current = false
      void repair()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- repair() closes over refs and ctx read fresh on each call; only ctx.streaming's transition matters here
  }, [ctx.streaming])

  // A failure forces the code open by DEFAULT — but as real `showCode`
  // state, not a `showCode || failed` derived at render, which used to make
  // the toggle button lie ("Code" while the code was actually showing) and
  // made it impossible to hide the code while still failed (clicking it just
  // flipped `showCode` behind the `|| failed` that kept it open regardless).
  // This only fires on the loading→failed TRANSITION (`phase.kind` in the
  // dependency array, not `phase` itself), so a later manual "Hide code"
  // click sticks instead of being forced back open every render.
  useEffect(() => {
    if (phase.kind === 'failed') setShowCode(true)
  }, [phase.kind])

  useEffect(() => {
    if (!doc) return
    let ready = false
    const onMessage = (ev: MessageEvent) => {
      const msg = acceptFrameMessage(ev, frame.current?.contentWindow ?? null)
      if (!msg) return
      if (msg.type === 'ready') {
        ready = true
        frame.current?.contentWindow?.postMessage({ type: 'render', code: current, autoplay: ctx.fresh }, '*')
      } else if (msg.type === 'height') setHeight(Math.min(msg.px, MAX_HEIGHT_PX))
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
        // Whatever this run was repairing toward didn't get saved, so there
        // is nothing left for a later 'done' to persist.
        unsaved.current = null
        if (current === code) firstError.current = msg.message
        lastFailure.current = { code: current, error: msg.message }
        const shouldRepair = shouldAutoRepair({ fresh: ctx.fresh, attempts: attempts.current, kind: msg.kind, canRepair })
        const action = repairAction({ shouldRepair, streaming: streamingRef.current })
        if (action === 'now') void repair()
        else if (action === 'wait') {
          // Held until the reply finishes streaming (the effect above starts
          // it); shown as "Fixing this diagram…" in the meantime, same as an
          // in-flight repair, since one is about to start.
          pendingRepair.current = true
          setRepairing(true)
        } else setPhase({ kind: 'failed', error: { kind: msg.kind, message: msg.message } })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- repair()/canRepair close over refs and ctx already covered by ctx.fresh/ctx.sessionId/ctx.messageId not changing per-render; ctx.streaming is read through streamingRef (see above) so this effect does not re-subscribe when it changes
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
        <button type="button" className="scene-code-toggle" aria-expanded={showCode} onClick={() => setShowCode((v) => !v)}>
          {showCode ? 'Hide code' : 'Code'}
        </button>
      </div>
      {showCode && (
        <CodeBlock language="scene" code={current}>
          <code>{current}</code>
        </CodeBlock>
      )}
    </div>
  )
}
