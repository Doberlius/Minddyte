import type { LanguageModel } from 'ai'
import { clientFor, resolveModel } from '@/lib/ollama'
import { chooseProvider } from '@/lib/provider'

export type ResolvedModel =
  | { ok: true; model: LanguageModel; modelId: string }
  | { ok: false; status: number; error: string }

/** The chat route's model choice, shared with diagram repair (same provider, same rules). */
export async function resolveChatModel(requested?: string): Promise<ResolvedModel> {
  const choice = chooseProvider(process.env, requested)
  // Standing rule: say what is wrong and how to fix it, never fail blankly.
  if (choice.kind === 'none') return { ok: false, status: 503, error: choice.reason }
  const modelId = choice.kind === 'hosted' ? choice.model : await resolveModel(choice.model)
  if (!modelId) {
    return {
      ok: false,
      status: 503,
      error:
        'No model available. Start Ollama and pull one with `ollama pull gemma3`, ' +
        'or set HOSTED_API_KEY to use a hosted model instead.',
    }
  }
  return { ok: true, model: clientFor(choice)(modelId), modelId }
}
