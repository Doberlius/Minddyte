import { NextResponse, type NextRequest } from 'next/server'
import {
  WORKSPACE_COOKIE,
  isWorkspaceId,
  newWorkspaceId,
  workspaceCookieOptions,
} from '@/lib/workspace'

/**
 * Gives a first-time browser exactly one workspace before anything else runs.
 *
 * The race this closes: a first page load fires several API requests in
 * parallel, none carrying a cookie yet, and `requireWorkspace` minted a
 * different workspace for each. The browser kept whichever Set-Cookie landed
 * last, so the first send went to a workspace that did not own the chat and
 * failed with 404 `session_not_found`. Middleware runs once per request and
 * before the route, so the cookie exists by the time any handler asks.
 *
 * Spec §1's "one place" still holds: the name, the flags and the validation
 * all come from `src/lib/workspace.ts`. `requireWorkspace` stays as the
 * fallback for any request this matcher does not see.
 *
 * Runtime: this runs on the default edge runtime. `newWorkspaceId` mints with
 * the global Web Crypto (`crypto.randomUUID()`) and `src/lib/workspace.ts`
 * imports nothing Node-only, so the module works in either runtime (Next
 * 15.5.18 also accepts `runtime: 'nodejs'` for middleware).
 *
 * Limit: this closes the race for a page load. A burst of API calls with no
 * cookie at all (an old tab whose cookie expired, say) can still mint more
 * than one workspace, exactly as before.
 */
export function middleware(request: NextRequest) {
  if (isWorkspaceId(request.cookies.get(WORKSPACE_COOKIE)?.value)) {
    return NextResponse.next()
  }

  const id = newWorkspaceId()

  // For THIS request's route: it reads the cookie from the request headers.
  // `request.cookies.set` rewrites the Cookie header, so a stale or invalid
  // value is replaced, not duplicated.
  request.cookies.set(WORKSPACE_COOKIE, id)
  const response = NextResponse.next({ request: { headers: request.headers } })

  // For the browser's later requests.
  response.cookies.set(WORKSPACE_COOKIE, id, workspaceCookieOptions())
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|scene/).*)'],
}
