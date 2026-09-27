'use client'

import { useContext, useEffect, useRef, useState } from 'react'
import { buildFrameDoc } from '@/scene/frameDoc'
import { acceptFrameMessage, type FrameErrorKind } from '@/scene/runtime/protocol'
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

  useEffect(() => {
    setDoc(buildFrameDoc(window.location.origin))
  }, [])

  useEffect(() => {
    if (!doc) return
    let ready = false
    const onMessage = (ev: MessageEvent) => {
      const msg = acceptFrameMessage(ev, frame.current?.contentWindow ?? null)
      if (!msg) return
      if (msg.type === 'ready') {
        ready = true
        frame.current?.contentWindow?.postMessage({ type: 'render', code, autoplay: ctx.fresh }, '*')
      } else if (msg.type === 'height') setHeight(msg.px)
      else if (msg.type === 'done') setPhase({ kind: 'ready' })
      else if (msg.type === 'error') setPhase({ kind: 'failed', error: { kind: msg.kind, message: msg.message } })
    }
    window.addEventListener('message', onMessage)
    const timer = setTimeout(() => {
      if (!ready) setPhase({ kind: 'failed', error: { kind: 'unsupported', message: 'The diagram frame did not start.' } })
    }, READY_TIMEOUT_MS)
    return () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
    }
  }, [doc, code, ctx.fresh])

  const failed = phase.kind === 'failed' ? phase.error : null
  return (
    <div className="scene-card" data-scene-index={index}>
      {doc ? (
        <iframe
          ref={frame}
          className="scene-frame"
          title="Interactive diagram"
          sandbox="allow-scripts"
          srcDoc={doc}
          style={{ height, display: failed ? 'none' : undefined }}
        />
      ) : (
        <div className="scene-status">Loading diagram…</div>
      )}
      {failed && (
        <div className="scene-error" role="alert">
          <strong>{FAILURE_TITLE[failed.kind]}</strong>
          <p>{failed.message}</p>
        </div>
      )}
      <div className="scene-foot">
        <button type="button" className="scene-code-toggle" aria-expanded={showCode || !!failed} onClick={() => setShowCode((v) => !v)}>
          {showCode ? 'Hide code' : 'Code'}
        </button>
      </div>
      {(showCode || failed) && (
        <CodeBlock language="scene" code={code}>
          <code>{code}</code>
        </CodeBlock>
      )}
    </div>
  )
}
