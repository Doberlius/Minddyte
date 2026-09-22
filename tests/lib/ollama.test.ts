import { describe, expect, it } from 'vitest'
import { apiBase } from '@/lib/ollama'

/**
 * Regression: POST /api/chat answered 503 in 14ms with "No model available",
 * while the daemon was running and holding several models.
 *
 * `.env` carried `OLLAMA_BASE_URL=http://localhost:11434` — the server root,
 * which is what the name asks for and what `.env.example` documents. The code
 * appended `/tags` to it and asked for `http://localhost:11434/tags`, a path
 * Ollama does not serve. The 404 became an empty model list, the empty list
 * became a null model, and the null model became a 503 that blamed the daemon
 * for a URL the app had built itself.
 *
 * The fallback default carried `/api` and the documented example did not, so
 * the app worked only when `.env` was absent. Both spellings are accepted now.
 */
describe('apiBase', () => {
  it('appends /api to a base URL that is the server root', () => {
    expect(apiBase('http://localhost:11434')).toBe('http://localhost:11434/api')
  })

  it('leaves a base that already names /api alone', () => {
    expect(apiBase('http://localhost:11434/api')).toBe('http://localhost:11434/api')
  })

  it('ignores a trailing slash in either spelling', () => {
    expect(apiBase('http://localhost:11434/')).toBe('http://localhost:11434/api')
    expect(apiBase('http://localhost:11434/api/')).toBe('http://localhost:11434/api')
  })

  it('keeps a host that is not localhost, and its port', () => {
    expect(apiBase('http://192.168.1.50:11434')).toBe('http://192.168.1.50:11434/api')
  })
})
