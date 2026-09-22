import { apiBase } from './ollama'
import { labelFor } from '@/constants/models'

/**
 * Which model answers, decided by environment alone.
 *
 * Pure on purpose: the choice is the part that can be wrong in a way nobody
 * notices until a deployment reports "no model available" while holding a
 * perfectly good API key. A function over `env` can be tested without a
 * network, a daemon, or a key.
 *
 * The two paths are deliberate. A developer runs Ollama on localhost and
 * should keep doing so; a deployment has no daemon and must never fall back
 * to one, because that failure reads as "no model" when the truth is "no
 * daemon, and you did not expect one here".
 */

const DEFAULT_HOSTED_BASE = 'https://ollama.com/api'
const DEFAULT_HOSTED_MODELS = 'gpt-oss:120b-cloud,gemma4:31b-cloud'

export type ProviderChoice =
  | { kind: 'hosted'; baseURL: string; apiKey: string; model: string }
  | { kind: 'local'; baseURL: string; model: string | null }
  | { kind: 'none'; reason: string }

/** What this deployment is willing to pay for. Not "what exists upstream". */
export function hostedModels(env: NodeJS.ProcessEnv): { id: string; label: string }[] {
  const raw = env.HOSTED_MODEL_IDS ?? DEFAULT_HOSTED_MODELS
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => ({ id, label: labelFor(id) }))
}

export function chooseProvider(
  env: NodeJS.ProcessEnv,
  requestedModel?: string | null,
): ProviderChoice {
  const apiKey = env.HOSTED_API_KEY?.trim()

  if (apiKey) {
    const models = hostedModels(env)
    if (models.length === 0) {
      return {
        kind: 'none',
        reason:
          'HOSTED_API_KEY is set but HOSTED_MODEL_IDS is empty, so this deployment ' +
          'offers no model. Set HOSTED_MODEL_IDS to a comma-separated list.',
      }
    }

    // An arbitrary requested model is a request to spend money on something
    // nobody chose, so the allow-list decides and the default catches the rest.
    const model = models.some((m) => m.id === requestedModel)
      ? (requestedModel as string)
      : models[0].id

    return {
      kind: 'hosted',
      baseURL: env.HOSTED_BASE_URL?.trim() || DEFAULT_HOSTED_BASE,
      apiKey,
      model,
    }
  }

  // A blank key with either of the other two hosted variables set is not
  // "no hosted setup" — it is the single most common deploy mistake. Railway
  // and Vercel both create a variable with an empty value the moment you add
  // its name, so an empty HOSTED_API_KEY next to a configured HOSTED_BASE_URL
  // or HOSTED_MODEL_IDS means someone forgot to paste the secret, not that
  // they want the local daemon. Falling back to localhost here would report
  // "no model, start Ollama" to someone who has no Ollama to start.
  if (env.HOSTED_BASE_URL?.trim() || env.HOSTED_MODEL_IDS?.trim()) {
    return {
      kind: 'none',
      reason:
        'HOSTED_API_KEY is empty, but HOSTED_BASE_URL or HOSTED_MODEL_IDS is set, which ' +
        'only makes sense for a hosted deployment. Paste the real key into HOSTED_API_KEY.',
    }
  }

  return {
    kind: 'local',
    baseURL: apiBase(env.OLLAMA_BASE_URL ?? 'http://localhost:11434'),
    // null means "ask the daemon what it has" — resolveModel's existing job.
    model: requestedModel ?? null,
  }
}
