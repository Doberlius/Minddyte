/**
 * What went wrong with a send, worked out from the transport's error.
 *
 * ai-sdk's transport wraps any non-2xx response in a plain `Error` whose
 * `message` IS the raw response body (`throw new Error(await response.text())`
 * in HttpChatTransport), so the body has to be parsed back out of it.
 *
 * Every input returns a failure. That is the point of the function rather than
 * a nicety: the code this replaces recognised one failure and returned early
 * from everything else, which meant `clearError()` never ran, `status` stayed
 * `'error'`, and the Send button was disabled until the page was reloaded.
 * Reproduced in a browser — one 503 and the composer was dead. A caller that
 * always receives a failure has no branch on which it can forget to recover.
 */

export type ChatFailure =
  /** The chat this browser remembers is gone: db:reset, a delete, a restore. */
  | { kind: 'session_not_found' }
  /** Anything else, with something the person can actually read. */
  | { kind: 'other'; message: string }

const GENERIC = 'The message could not be sent. Your text is still in the box — try again.'

type ErrorBody = { error?: unknown; message?: unknown }

export function classifyChatFailure(raw: string): ChatFailure {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // An HTML error page, a stack trace, a truncated stream. Not readable as
    // a cause, but still a failure that has to be finished handling.
    return { kind: 'other', message: GENERIC }
  }

  // `JSON.parse` happily returns a string, a number or null. Only an object
  // can carry the fields below.
  if (typeof parsed !== 'object' || parsed === null) {
    return { kind: 'other', message: GENERIC }
  }
  const body = parsed as ErrorBody

  // The marker is the WHOLE field, never a substring: a reply that happens to
  // discuss the string must not be read as the session being gone.
  if (body.error === 'session_not_found') return { kind: 'session_not_found' }

  const sentence =
    typeof body.message === 'string' && body.message.trim()
      ? body.message
      : typeof body.error === 'string' && body.error.trim()
        ? body.error
        : GENERIC

  return { kind: 'other', message: sentence }
}
