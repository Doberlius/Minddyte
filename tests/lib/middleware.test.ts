import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '@/middleware'
import { WORKSPACE_COOKIE, COOKIE_MAX_AGE, isWorkspaceId } from '@/lib/workspace'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function visit(cookie?: string) {
  return new NextRequest('http://localhost/', {
    headers: cookie ? { cookie } : {},
  })
}

/** The cookie header the route will see, as Next carries an overridden request header. */
function forwardedCookie(res: Response): string | null {
  const overridden = res.headers.get('x-middleware-override-headers') ?? ''
  if (!overridden.split(',').includes('cookie')) return null
  return res.headers.get('x-middleware-request-cookie')
}

describe('workspace middleware', () => {
  it('mints one workspace for a visitor with no cookie, for the route and the browser', () => {
    const res = middleware(visit())
    const setCookies = res.headers.getSetCookie()
    expect(setCookies).toHaveLength(1)
    const m = setCookies[0].match(new RegExp(`^${WORKSPACE_COOKIE}=([^;]+)`))
    expect(m).not.toBeNull()
    const id = m![1]
    expect(id).toMatch(V4)
    expect(setCookies[0]).toMatch(/HttpOnly/i)
    expect(setCookies[0]).toMatch(/SameSite=lax/i)
    expect(setCookies[0]).toMatch(/Path=\//)
    expect(setCookies[0]).toContain(`Max-Age=${COOKIE_MAX_AGE}`)
    expect(forwardedCookie(res)).toBe(`${WORKSPACE_COOKIE}=${id}`)
  })

  it('replaces an invalid cookie', () => {
    const res = middleware(visit(`${WORKSPACE_COOKIE}=nope`))
    const setCookies = res.headers.getSetCookie()
    expect(setCookies).toHaveLength(1)
    const id = setCookies[0].match(new RegExp(`^${WORKSPACE_COOKIE}=([^;]+)`))![1]
    expect(id).not.toBe('nope')
    expect(isWorkspaceId(id)).toBe(true)
    const forwarded = forwardedCookie(res)
    expect(forwarded).toBe(`${WORKSPACE_COOKIE}=${id}`)
    expect(forwarded).not.toContain('nope')
  })

  it('passes a valid cookie through untouched', () => {
    const id = '3f2b8c1e-5d4a-4e6f-8a9b-0c1d2e3f4a5b'
    const res = middleware(visit(`${WORKSPACE_COOKIE}=${id}`))
    expect(res.headers.getSetCookie()).toHaveLength(0)
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })
})
