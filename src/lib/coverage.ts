import { PROVISIONAL } from './provisional'

export type WordCoverage = { coverage: number; words: string[] }

/**
 * Rare-word coverage (ticket 18). Each draft word weighs its rarity across the
 * workspace, idf = ln((max(n, reachIdfMinChats) + 1) / (df + 0.5)): a word in
 * every chat weighs little, a word in NO chat weighs most — so "the plot of
 * Hamlet" reaches nothing, because "hamlet" carries the draft and no chat has it.
 * A chat is reached when the words it holds carry >= reachCoverage of the
 * draft's total weight AND at least min(reachMinWords, #words) of them match.
 * Returns only reached chats; `words` are the matched ones, in draft order.
 */
export function coverageReach(
  words: string[],
  chatsByWord: Map<string, Set<string>>,
  otherChats: number,
): Map<string, WordCoverage> {
  const out = new Map<string, WordCoverage>()
  if (!words.length) return out
  const n = Math.max(otherChats, PROVISIONAL.reachIdfMinChats)
  const idf = words.map((w) => Math.log((n + 1) / ((chatsByWord.get(w)?.size ?? 0) + 0.5)))
  const total = idf.reduce((a, b) => a + b, 0)
  const acc = new Map<string, WordCoverage>()
  words.forEach((w, i) => {
    for (const id of chatsByWord.get(w) ?? []) {
      const e = acc.get(id) ?? { coverage: 0, words: [] }
      e.coverage += idf[i] / total
      e.words.push(w)
      acc.set(id, e)
    }
  })
  const need = Math.min(PROVISIONAL.reachMinWords, words.length)
  for (const [id, e] of acc) if (e.coverage >= PROVISIONAL.reachCoverage && e.words.length >= need) out.set(id, e)
  return out
}
