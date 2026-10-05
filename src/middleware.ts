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
 * Runtime: edge, deliberately. Installed Next is 15.5.18, and its middleware
 * config schema (node_modules/next/dist/build/segment-config/middleware/
 * middleware-config.js: matcher, regions, unstable_allowDynamic) has no
 * `runtime` key, so `runtime: 'nodejs'` is not supported for middleware here.
 * So `newWorkspaceId` mints with the global Web Crypto (`crypto.randomUUID()`)
 * and `src/lib/workspace.ts` no longer imports `node:crypto`.
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
