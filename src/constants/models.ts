/**
 * Display names for Ollama tags — cosmetic only.
 *
 * **This file no longer decides what you can run.** Availability comes from the
 * Ollama daemon at request time (`listModels()` in `@/lib/ollama`), because a
 * hardcoded list can only ever be a guess about someone else's machine: it
 * offered five cloud models that fail without `ollama signin`, while hiding a
 * local model that was pulled and working.
 *
 * A tag with no entry here displays as its raw id. Adding one is optional and
 * affects nothing but the label.
 */
export const MODEL_LABELS: Record<string, string> = {
  'gemma4:31b-cloud': 'Gemma 4 31B',
  'qwen3.5:397b-cloud': 'Qwen 3.5 397B',
  'gpt-oss:120b-cloud': 'GPT-OSS 120B',
  'gpt-oss:20b-cloud': 'GPT-OSS 20B',
  'nemotron-3-super:cloud': 'Nemotron 3 Super',
  'gemma4:e4b': 'Gemma 4 E4B',
}

/** A friendly name if we have one, otherwise the tag itself. */
export function labelFor(id: string): string {
  return MODEL_LABELS[id] ?? id
}

/**
 * Cloud tags run on Ollama's infrastructure rather than this machine, so they
 * need the daemon to be signed in (`ollama signin`). The app itself never
 * authenticates — it talks to localhost and the daemon relays upstream with
 * its own credentials.
 */
export function isCloudModel(id: string): boolean {
  return id.endsWith('-cloud') || id.endsWith(':cloud')
}

/**
 * Tried first when the client names no model — a *preference*, not a claim
 * that it exists. If the daemon does not report it, `resolveModel` falls
 * through to whatever is actually available, so a machine that has never run
 * `ollama signin` still works.
 */
export const PREFERRED_MODEL_ID = 'nemotron-3-super:cloud'
