import { createOllama } from 'ollama-ai-provider-v2'
import { labelFor, isCloudModel, PREFERRED_MODEL_ID } from '@/constants/models'
import type { ModelEntry } from '@/types'

/**
 * Ollama serves its HTTP API under `/api`, but `OLLAMA_BASE_URL` reads like the
 * server's address and `.env.example` documents it as exactly that —
 * `http://localhost:11434`. The fallback default below used to carry `/api`
 * while the documented value did not, so the app worked with no `.env` at all
 * and broke the moment someone created one from the example.
 *
 * It broke quietly, too. `${BASE}/tags` became `http://localhost:11434/tags`,
 * which Ollama answers 404; `listModels` turns any non-OK response into an
 * empty list, an empty list resolves to no model, and the chat route reports
 * "No model available. Start Ollama…" — blaming a daemon that was running
 * the whole time for a URL the app had assembled itself.
 *
 * Both spellings are accepted now, so neither file can be wrong.
 */
export function apiBase(raw: string): string {
  const trimmed = raw.replace(/\/+$/, '')
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`
}

/**
 * Exported so the routes that talk to the daemon directly — /api/models for
 * delete, /api/pull — share this one resolution instead of each keeping its
 * own copy of the expression. All three copies had the same bug, and fixing
 * one of them would have left the other two to be found later, separately.
 */
export const API_BASE = apiBase(process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434')

const BASE = API_BASE

/**
 * The provider client. Note it carries **no credential** — Minddyte talks to
 * the local daemon and never authenticates. A cloud tag works because the
 * daemon itself is signed in and relays upstream on our behalf.
 */
export const ollama = createOllama({ baseURL: BASE })

type Cached = { at: number; models: ModelEntry[] }
let cached: Cached | null = null
const TTL_MS = 30_000

function humanSize(bytes: number): string | undefined {
  // Cloud tags report a ~300-byte stub, not 0 — nothing of them is on this
  // disk, so anything under a megabyte has no meaningful local footprint.
  if (bytes < 1e6) return undefined
  const gb = bytes / 1e9
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`
}

/**
 * What this machine can actually run, asked of the daemon rather than assumed.
 *
 * `/api/tags` reports local models that have been pulled plus cloud tags the
 * daemon has seen, so everything here is known-good — a machine with no account
 * still gets a working list instead of five entries that all fail.
 *
 * It **under-reports**, though: a cloud tag the daemon has never touched can run
 * without appearing here (measured with `nemotron-3-super:cloud`). So treat this
 * as "definitely available", never as "all that is possible" — which is why
 * `resolveModel` does not reject a tag merely for being absent.
 *
 * Sorted deterministically (local first, then by id) so the fallback default
 * does not change between runs — Ollama's own ordering is not guaranteed.
 * Cached briefly because the chat route asks on every request; the call is to
 * localhost, but there is no reason to make it hundreds of times a minute.
 *
 * Returns `[]` when the daemon is unreachable. Callers must treat that as
 * "nothing available" and say so, never as an error to swallow.
 */
export async function listModels(force = false): Promise<ModelEntry[]> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.models
  try {
    const res = await fetch(`${BASE}/tags`)
    if (!res.ok) return []
    const body = (await res.json()) as { models?: { name: string; size?: number }[] }
    const models: ModelEntry[] = (body.models ?? [])
      .map((m) => ({
        id: m.name,
        label: labelFor(m.name),
        location: isCloudModel(m.name) ? ('cloud' as const) : ('local' as const),
        size: humanSize(m.size ?? 0),
        // Everything /api/tags reports is ready to use. Offering models that
        // are NOT yet pulled needs a separate catalogue and the /api/pull
        // flow — not built.
        downloaded: true,
      }))
      .sort((a, b) =>
        a.location !== b.location
          ? a.location === 'local' ? -1 : 1
          : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      )
    cached = { at: Date.now(), models }
    return models
  } catch {
    return []
  }
}

/**
 * Pick the model to run.
 *
 * **An explicit choice is honoured as-is, not checked against a list.** Measured:
 * `nemotron-3-super:cloud` is absent from `/api/tags` and returns 502 from
 * `/api/show`, yet generates perfectly — so neither endpoint can tell you what
 * is usable. `/api/tags` under-reports and `/api/show` produces false negatives.
 * The daemon is the only authority, so a requested tag goes straight through and
 * a bad one surfaces as a provider error, which is honest rather than a guess
 * dressed up as validation.
 *
 * With no choice made, only a model the daemon has actually reported is picked,
 * so the default can never be something unusable: `PREFERRED_MODEL_ID` if it is
 * listed, otherwise the first **cloud** model — cloud is preferred for answer
 * quality (spec §9) — otherwise whatever exists. `null` means the daemon offers
 * nothing at all, which the caller must surface.
 */
export async function resolveModel(requested?: string | null): Promise<string | null> {
  if (requested) return requested
  const available = await listModels()
  if (available.length === 0) return null
  if (available.some((m) => m.id === PREFERRED_MODEL_ID)) return PREFERRED_MODEL_ID
  return (available.find((m) => m.location === 'cloud') ?? available[0]).id
}
