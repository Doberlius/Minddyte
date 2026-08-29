import type { ModelEntry } from '@/types'

/**
 * Models the user can pick from. All are Ollama Cloud models — they run on
 * Ollama's infrastructure, so there is nothing to download and no local size.
 * Requires `ollama signin` (or an API key) for requests to authenticate.
 *
 * Tags verified against ollama.com/library. Do not add an entry without
 * checking the tag exists on the corresponding `/library/<name>/tags` page.
 */
export const MODEL_REGISTRY: ModelEntry[] = [
  { id: 'gemma4:31b-cloud',       label: 'Gemma 4 31B',      location: 'cloud' },
  { id: 'qwen3.5:397b-cloud',     label: 'Qwen 3.5 397B',    location: 'cloud' },
  { id: 'gpt-oss:120b-cloud',     label: 'GPT-OSS 120B',     location: 'cloud' },
  { id: 'gpt-oss:20b-cloud',      label: 'GPT-OSS 20B',      location: 'cloud' },
  { id: 'nemotron-3-super:cloud', label: 'Nemotron 3 Super', location: 'cloud' },
]

/** Used when the user hasn't chosen a model, or chose one we no longer offer. */
export const DEFAULT_MODEL_ID = 'nemotron-3-super:cloud'

const MODEL_IDS = new Set(MODEL_REGISTRY.map((m) => m.id))

/** Type guard: is `id` a model we actually offer? */
export function isKnownModel(id: string | null | undefined): id is string {
  return !!id && MODEL_IDS.has(id)
}

/** Returns `id` if it's a registered model, otherwise `DEFAULT_MODEL_ID`. */
export function resolveModel(id: string | null | undefined): string {
  return isKnownModel(id) ? id : DEFAULT_MODEL_ID
}
