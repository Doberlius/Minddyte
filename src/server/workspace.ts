import { cookies } from 'next/headers'
import { COOKIE_MAX_AGE, WORKSPACE_COOKIE, isWorkspaceId, newWorkspaceId } from '@/lib/workspace'

/**
 * The workspace this request belongs to, minting one if this browser has
 * never been here.
 *
 * ONE place reads or writes this cookie. Spec §1 asks for that explicitly,
 * and the reason is that a second place will eventually disagree about the
 * name, the flags or the validation, and the failure that produces — a new
 * empty workspace on some requests and not others — reads as data loss.
 *
 * Only callable from a route handler. `cookies()` is readonly in a server
 * component, so a page that called this would throw on the write.
 */
export async function requireWorkspace(): Promise<string> {
  const jar = await cookies()
  const claimed = jar.get(WORKSPACE_COOKIE)?.value

  if (isWorkspaceId(claimed)) return claimed

  const id = newWorkspaceId()
  jar.set(WORKSPACE_COOKIE, id, {
    httpOnly: true,
    // Not in development: a Secure cookie is dropped over plain http, so
    // setting it unconditionally would mint a new workspace on every single
    // request on localhost and nothing would ever persist.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })
  return id
}
