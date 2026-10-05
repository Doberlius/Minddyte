import { randomUUID } from 'node:crypto'

/**
 * Everything about a workspace's identity that does not need a request.
 *
 * Kept apart from the cookie handling so it can be tested without one, and
 * so the name and lifetime have exactly one definition — a reader and a
 * writer that disagree about a cookie's name produce a new workspace on
 * every request, which looks like data loss and is very hard to see.
 */

export const WORKSPACE_COOKIE = 'minddyte_ws'

/** Spec §1. Clearing cookies before this elapses means starting over. */
export const COOKIE_MAX_AGE = 30 * 24 * 60 * 60

/**
 * Not signed, and deliberately so: the id IS the secret, and a random v4
 * uuid cannot be guessed. A signature would prove the server minted it,
 * which buys nothing once an unguessable value is already required. Spec §1
 * records this as considered rather than forgotten.
 */
export function newWorkspaceId(): string {
  // The global Web Crypto, present in Node and in the edge runtime alike.
  return globalThis.crypto.randomUUID()
}

/**
 * The cookie's flags, for every writer (`requireWorkspace` and the
 * middleware). Called, not a constant, so `secure` reads NODE_ENV when it is
 * used.
 */
export function workspaceCookieOptions() {
  return {
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
    sameSite: 'lax' as const,
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  }
}

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * A cookie is client-controlled, so what arrives is a claim, not a fact.
 * Validating here means no unchecked string ever reaches a WHERE clause,
 * and an altered cookie gets a fresh empty workspace rather than an error
 * that leaks whether some other value would have worked.
 */
export function isWorkspaceId(value: unknown): value is string {
  return isUuidV4(value)
}

/**
 * A v4 uuid, the only kind this app mints: `newWorkspaceId` for workspaces,
 * Postgres's gen_random_uuid() for chats. A route checks a chat id from the
 * URL with this before it reaches a WHERE clause, where Postgres would reject
 * a malformed one with an error (a 500) instead of "no such chat".
 */
export function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && V4.test(value)
}
