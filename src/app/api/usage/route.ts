import { MAX_REQUESTS } from "@/lib/rate-limit"
import { clientKey, peek } from "@/server/rate-limit"

/**
 * What this caller has left, without spending any of it.
 *
 * Deliberately NOT rate limited itself. A meter that costs what it measures
 * would report a number that its own reading had already made wrong, and a
 * visitor who opened the card twice would be punished for looking.
 */
export async function GET(req: Request) {
  const v = peek(clientKey(req))

  return Response.json({
    // `remaining` from `allowance` counts what is left AFTER the request it
    // was asked about. Nothing is being spent here, so the untaken one goes
    // back — otherwise a fresh visitor is told they have nine.
    remaining: v.allowed ? v.remaining + 1 : 0,
    limit: MAX_REQUESTS,
    resetInSeconds: Math.ceil(v.resetInMs / 1000),
  })
}
