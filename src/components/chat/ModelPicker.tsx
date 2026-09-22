'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Cloud } from 'lucide-react'
import type { ModelEntry } from '@/types'

/**
 * Which model answers.
 *
 * Cloud tags only, deliberately. They are the ones worth choosing between —
 * a local 8B and a hosted 400B are not the same conversation — and the local
 * one this machine has is already the fallback when nothing is picked.
 *
 * Worth being precise about what a cloud tag IS here, because the name
 * suggests otherwise: it still goes through the Ollama daemon on localhost.
 * The app holds no credential; the daemon is signed in and relays upstream on
 * its behalf (`constants/models.ts`). So this changes the answer's quality,
 * not where the app can run — a deployment without a daemon has no models at
 * all, cloud or otherwise.
 *
 * The list is asked for on first open rather than on mount: most visits never
 * touch it, and the daemon call is only worth making when someone is choosing.
 */

export function ModelPicker({
  value,
  onChange,
}: {
  /** The chosen tag, or null to let the server pick. */
  value: string | null
  onChange: (id: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<ModelEntry[] | null>(null)
  const [failed, setFailed] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || models !== null) return
    let cancelled = false
    fetch('/api/models')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('models'))))
      .then((all: ModelEntry[]) => {
        if (cancelled) return
        setModels(Array.isArray(all) ? all.filter((m) => m.location === 'cloud') : [])
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [open, models])

  useEffect(() => {
    if (!open) return
    // Decided by where the press landed, not by stopping propagation: a
    // capture listener on window runs before every React handler, so a guard
    // inside the panel would close it before its own clicks arrived.
    function onPointerDown(event: PointerEvent) {
      if (box.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = models?.find((m) => m.id === value)
  const label = current?.label ?? (value ? value : 'Model: automatic')

  return (
    <div className="model-pick" ref={box}>
      <button
        className="model-pill"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Cloud size={12} aria-hidden="true" />
        {label}
      </button>

      {open && (
        <div className="model-pop" role="listbox" aria-label="Cloud models">
          <div className="picker-head">Cloud models — answered upstream via your daemon</div>

          {failed && (
            <p className="picker-empty">
              Could not reach Ollama. The daemon has to be running for any model to answer.
            </p>
          )}

          {!failed && models === null && <p className="picker-empty">Asking the daemon…</p>}

          {!failed && models?.length === 0 && (
            <p className="picker-empty">
              No cloud models on this daemon. Run <code>ollama signin</code>, then reopen this.
            </p>
          )}

          {models?.map((m) => (
            <div
              key={m.id}
              className={`model-row${m.id === value ? ' is-on' : ''}`}
              role="option"
              aria-selected={m.id === value}
              onClick={() => {
                onChange(m.id)
                setOpen(false)
              }}
            >
              <span className="model-name">{m.label}</span>
              {m.id === value && <Check size={13} aria-hidden="true" />}
            </div>
          ))}

          {models !== null && models.length > 0 && (
            <div
              className={`model-row${value === null ? ' is-on' : ''}`}
              role="option"
              aria-selected={value === null}
              onClick={() => {
                onChange(null)
                setOpen(false)
              }}
            >
              <span className="model-name">Automatic</span>
              <span className="model-note">whatever the daemon offers</span>
              {value === null && <Check size={13} aria-hidden="true" />}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
