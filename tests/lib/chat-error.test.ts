import { describe, it, expect } from 'vitest'
import { classifyChatFailure } from '@/lib/chat-error'

/**
 * The transport hands us a plain `Error` whose `message` IS the raw response
 * body, so telling one failure from another means parsing that text back out.
 * Getting this wrong is what left the composer dead: the old code recognised
 * exactly one failure and returned early from every other, never clearing the
 * error state, and `Send` stayed disabled until the page was reloaded.
 *
 * So the rule these tests hold to is: EVERY input produces a failure this
 * component knows how to finish handling. There is no early return.
 */

describe('classifyChatFailure', () => {
  it('recognises the marker the chat route puts on a dead session', () => {
    const body = JSON.stringify({
      error: 'session_not_found',
      message: 'This chat no longer exists. Starting a new one will fix it.',
    })

    expect(classifyChatFailure(body)).toEqual({ kind: 'session_not_found' })
  })

  it('carries the route\'s own sentence through for anything else', () => {
    // What /api/chat actually returns when the daemon has no model.
    const body = JSON.stringify({
      error: 'No model available. Start Ollama, then pull one with `ollama pull gemma3`.',
    })

    expect(classifyChatFailure(body)).toEqual({
      kind: 'other',
      message: 'No model available. Start Ollama, then pull one with `ollama pull gemma3`.',
    })
  })

  it('prefers the human sentence when a body carries both', () => {
    const body = JSON.stringify({ error: 'model_timeout', message: 'The model took too long.' })

    expect(classifyChatFailure(body)).toEqual({ kind: 'other', message: 'The model took too long.' })
  })

  it('still classifies a body that is not JSON at all', () => {
    // A proxy's HTML error page, a dropped connection, a stack trace — the
    // old code hit its `catch` here and returned, which is the exact path
    // that bricked the button.
    const failure = classifyChatFailure('<html><body>502 Bad Gateway</body></html>')

    expect(failure.kind).toBe('other')
    expect(failure.kind === 'other' && failure.message.length).toBeGreaterThan(0)
  })

  it('classifies an empty message rather than returning nothing', () => {
    const failure = classifyChatFailure('')

    expect(failure.kind).toBe('other')
    expect(failure.kind === 'other' && failure.message.length).toBeGreaterThan(0)
  })

  it('does not mistake a message that merely mentions the marker', () => {
    // The marker is a FIELD, not a substring — a reply discussing the string
    // must not be read as the session being gone.
    const body = JSON.stringify({ error: 'the phrase session_not_found appears in this text' })

    expect(classifyChatFailure(body).kind).toBe('other')
  })
})
