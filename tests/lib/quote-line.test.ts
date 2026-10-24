import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QuoteLine } from '@/components/chat/QuoteLine'

/**
 * A quote line reads like the message it quotes: a model reply is markdown,
 * so its preview shows **bold** as bold and drops a leading `#`; your own
 * message is shown exactly as typed, so its preview is too.
 */
const html = (props: Parameters<typeof QuoteLine>[0]) => renderToStaticMarkup(createElement(QuoteLine, props))

describe('QuoteLine', () => {
  it('renders a reply’s inline markdown and drops its heading marker', () => {
    const out = html({ kind: 'sent', preview: '# Setup **guide** with `npm ci`', markdown: true })
    expect(out).toContain('<strong>guide</strong>')
    expect(out).toContain('npm ci')
    expect(out).not.toContain('**')
    expect(out).not.toContain('# Setup')
    expect(out).toContain('Setup')
  })

  it('keeps the composer’s "Replying to:" in front of a rendered reply preview', () => {
    const out = html({ kind: 'compose', preview: '**Short answer:** yes', markdown: true })
    expect(out).toContain('↩ Replying to: ')
    expect(out).toContain('<strong>Short answer:</strong>')
  })

  it('shows your own message exactly as typed', () => {
    const out = html({ kind: 'sent', preview: '2*3*4 and **x**', markdown: false })
    expect(out).toContain('↩ 2*3*4 and **x**')
    expect(out).not.toContain('<strong>')
  })

  it('reads a deleted quote the same either way', () => {
    expect(html({ kind: 'sent', preview: null, markdown: true })).toContain('↩ replying to a deleted message')
  })
})
