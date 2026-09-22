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
    // Secure unless this is explicitly a development server. Written as
    // `!== 'development'` rather than `=== 'production'` on purpose: the
    // first is wrong only when someone deliberately says development, the
    // second is wrong whenever NODE_ENV is unset, misspelled, or says
    // something like "staging" — and being wrong there means the id that
    // separates two visitors' conversations travels in the clear. Next sets
    // NODE_ENV=development for `next dev` itself, so nothing has to be
    // configured for a developer to get a working cookie over http.
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })
  return id
}
