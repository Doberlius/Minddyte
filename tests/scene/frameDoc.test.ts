import { describe, it, expect } from 'vitest'
import { buildFrameDoc, frameCsp } from '@/scene/frameDoc'

describe('frameCsp', () => {
  const csp = frameCsp('https://minddyte.onrender.com')

  it('denies everything by default and never allows the network', () => {
    expect(csp.startsWith("default-src 'none'")).toBe(true)
    expect(csp).not.toContain('connect-src')
  })

  it('allows scripts, styles and fonts only from /scene/ on the same origin', () => {
    expect(csp).toContain('script-src https://minddyte.onrender.com/scene/;')
    expect(csp).toContain("style-src https://minddyte.onrender.com/scene/ 'unsafe-inline'")
    expect(csp).toContain('font-src https://minddyte.onrender.com/scene/')
  })

  it('allows only blob: workers and data: images', () => {
    expect(csp).toContain('worker-src blob:')
    expect(csp).toContain('img-src data:')
  })
})

describe('buildFrameDoc', () => {
  it('loads KaTeX and the runtime from /scene/, with the CSP first', () => {
    const doc = buildFrameDoc('http://localhost:3000')
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<script'))
    expect(doc).toContain('<script src="http://localhost:3000/scene/katex/katex.min.js"></script>')
    expect(doc).toContain('<script src="http://localhost:3000/scene/runtime.js"></script>')
    expect(doc).not.toMatch(/<script>(?!<\/script>)/) // no inline script at all
  })

  it('refuses anything that is not a plain origin', () => {
    expect(() => buildFrameDoc('http://x" onload="alert(1)')).toThrow()
    expect(() => buildFrameDoc('javascript:alert(1)')).toThrow()
    expect(() => buildFrameDoc('https://a.example/path')).toThrow()
  })
})
