import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from '@/components/chat/Markdown'
import { InlineText } from '@/components/ui/InlineText'

/**
 * A model reply arrives as markdown. Shown raw, a reply reads `**bold**`,
 * `### Heading` and a code block with its fences — and its line breaks
 * collapse into one paragraph. These tests render the component to HTML on
 * the server (no browser needed) and check what a reader would see.
 */
const md = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }))

describe('Markdown (model replies)', () => {
  it('renders bold, italic and inline code without their markers', () => {
    const html = md('Use **parallel** writes, *not* one `COPY` at a time.')
    expect(html).toContain('<strong>parallel</strong>')
    expect(html).toContain('<em>not</em>')
    expect(html).toContain('<code>COPY</code>')
    expect(html).not.toContain('**')
  })

  it('renders headings, lists, quotes and rules as real elements', () => {
    const html = md('## Why\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n---\n\nend')
    expect(html).toContain('<h2>Why</h2>')
    expect(html).toMatch(/<ul>\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ul>/)
    expect(html).toMatch(/<ol>\s*<li>first<\/li>/)
    expect(html).toMatch(/<blockquote>\s*<p>quoted<\/p>\s*<\/blockquote>/)
    expect(html).toContain('<hr/>')
  })

  it('renders a table inside a scrollable wrapper', () => {
    const html = md('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(html).toMatch(/<div class="md-table"><table>/)
    expect(html).toContain('<th>a</th>')
    expect(html).toContain('<td>2</td>')
  })

  it('gives a fenced code block a header with its language and a Copy button, and colours it', () => {
    const html = md('```python\ndef add(a, b):\n    return a + b\n```')
    expect(html).toContain('class="codeblock"')
    expect(html).toMatch(/class="codeblock-lang">python</)
    expect(html).toMatch(/<button[^>]*>Copy<\/button>/)
    expect(html).toContain('hljs-keyword')
  })

  it('labels a code block with no language "text", and does not guess colours', () => {
    const html = md('```\nplain words here\n```')
    expect(html).toMatch(/class="codeblock-lang">text</)
    expect(html).not.toContain('hljs-')
    expect(html).toContain('plain words here')
  })

  // Beyond highlight.js's common set, added because the user's chats use them.
  it('colours a Dockerfile', () => {
    expect(md('```dockerfile\nFROM node:20\nRUN npm ci\n```')).toContain('hljs-keyword')
  })

  it('shows an unknown language by name, uncoloured, without failing', () => {
    const html = md('```madeuplang\nx := 1\n```')
    expect(html).toMatch(/class="codeblock-lang">madeuplang</)
    expect(html).toContain('x := 1')
  })

  it('never renders raw HTML from a reply', () => {
    const html = md('Hello <script>alert(1)</script> <b>there</b>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<b>')
  })

  it('drops a javascript: link target', () => {
    expect(md('[click](javascript:alert(1))')).not.toContain('javascript:')
  })

  it('opens web links in a new tab, safely', () => {
    const html = md('[docs](https://www.postgresql.org/docs/)')
    expect(html).toContain('href="https://www.postgresql.org/docs/"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })
})

describe('InlineText (stored sentences)', () => {
  const inline = (text: string) => renderToStaticMarkup(createElement(InlineText, { text }))

  it('shows bold, italic and code in a sentence without the markers', () => {
    const html = inline('The **17 Goals** use *targets* and `max.poll.records`.')
    expect(html).toContain('<strong>17 Goals</strong>')
    expect(html).toContain('<em>targets</em>')
    expect(html).toContain('<code>max.poll.records</code>')
    expect(html).not.toContain('**')
  })

  it('drops a heading marker at the start of a sentence', () => {
    expect(inline('### Why Postgres wins')).toBe('Why Postgres wins')
  })
})
