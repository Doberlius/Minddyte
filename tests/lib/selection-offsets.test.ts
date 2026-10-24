import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from '@/components/chat/Markdown'
import { cpSlice } from '@/lib/quote'
import { selectionOffsets } from '@/lib/selection-offsets'

/**
 * A highlighted part of a message, placed at code-point offsets in its STORED
 * content. A wrong part is worse than the whole message, so whenever the
 * place is not certain the answer is null (the caller quotes the whole).
 */

const verbatim = (content: string, selected: string, hint?: number) =>
  selectionOffsets(content, selected, { verbatim: true, hint })
const reply = (content: string, selected: string) => selectionOffsets(content, selected, { verbatim: false })

/** What a reader sees of a stored span: markdown syntax dropped, whitespace collapsed. */
const shownText = (s: string) =>
  s
    .replace(/^(?=[^\n]*[-=_*])[ \t|:+\-=_*]+$/gm, '')
    .replace(/\]\([^)]*\)|\]\[[^\]]*\]|<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/g, '')
    .replace(/^[ \t]*(?:[-+]|\d{1,9}[.)])[ \t]/gm, '')
    .replace(/[*_~`#<>|[\]\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const ws = (s: string) => s.replace(/\s+/g, ' ').trim()

/** The span found, and the check every markdown span must pass. */
function placed(content: string, selected: string) {
  const at = reply(content, selected)
  expect(at).not.toBeNull()
  expect(shownText(cpSlice(content, at!.start, at!.end))).toBe(ws(selected))
  return at!
}

/** For code, where a `*` or `_` is shown: only the span is checked. */
function placedLoose(content: string, selected: string) {
  const at = reply(content, selected)
  expect(at).not.toBeNull()
  return at!
}
const span = (at: { start: number; end: number }) => [at.start, at.end] as const

describe('selectionOffsets — your own message (verbatim)', () => {
  it('finds a plain match', () => {
    expect(verbatim('the quick brown fox', 'quick')).toEqual({ start: 4, end: 9 })
  })

  it('picks the repeated word nearest the hint', () => {
    expect(verbatim('ab ab ab', 'ab', 3)).toEqual({ start: 3, end: 5 })
    expect(verbatim('ab ab ab', 'ab', 6)).toEqual({ start: 6, end: 8 })
    expect(verbatim('ab ab ab', 'ab', 0)).toEqual({ start: 0, end: 2 })
  })

  it('does not guess between repeats when there is no hint', () => {
    expect(verbatim('ab ab ab', 'ab')).toBeNull()
  })

  it('does not guess when the hint is equally near two repeats', () => {
    // "ab" at 0 and at 4; the hint 2 is 2 away from both.
    expect(verbatim('ab  ab', 'ab', 2)).toBeNull()
  })

  it('counts code points, so an emoji before the selection moves it by one', () => {
    const content = '😀 hi there 😀 hi'
    // UTF-16 index of the second "hi" is 15; in code points it is 13.
    const at = verbatim(content, 'hi', 15)
    expect(at).toEqual({ start: 13, end: 15 })
    expect(cpSlice(content, at!.start, at!.end)).toBe('hi')
  })

  it('counts an emoji inside the selection once', () => {
    const content = 'say 😀 hi'
    const at = verbatim(content, '😀 hi')
    expect(at).toEqual({ start: 4, end: 8 })
    expect(cpSlice(content, at!.start, at!.end)).toBe('😀 hi')
  })

  it('keeps line breaks the way they were typed', () => {
    const content = 'first line\nsecond line'
    expect(verbatim(content, 'line\nsecond')).toEqual({ start: 6, end: 17 })
  })

  it('gives null for a selection that is not in the message', () => {
    expect(verbatim('the quick brown fox', 'lazy dog')).toBeNull()
  })

  it('gives null for an empty or blank selection', () => {
    expect(verbatim('the quick brown fox', '')).toBeNull()
    expect(verbatim('the quick brown fox', '  \n ')).toBeNull()
  })
})

describe('selectionOffsets — a model reply (rendered markdown)', () => {
  it('places text across a bold marker, without the markers around it', () => {
    expect(placed('**bold** text', 'bold text')).toEqual({ start: 2, end: 13 })
  })

  it('places a selection that is all inside bold', () => {
    expect(placed('Some **bold words** here', 'bold words')).toEqual({ start: 7, end: 17 })
  })

  it('places a line of a code block, keeping a * that the code shows', () => {
    const content = 'Example:\n\n```python\nprint("a*b")\n```\n'
    const at = reply(content, 'print("a*b")')
    expect(at).toEqual({ start: 20, end: 32 })
    expect(cpSlice(content, at!.start, at!.end)).toBe('print("a*b")')
  })

  it('places link text without the bracket or the URL', () => {
    expect(placed('See [link text](https://x) now.', 'link text')).toEqual({ start: 5, end: 14 })
  })

  it('places a selection running out of a link, keeping the URL that sits inside it', () => {
    const content = 'See [the docs](https://x.com/a) now.'
    const at = placed(content, 'the docs now')
    expect(at).toEqual({ start: 5, end: 35 })
  })

  it('places a list item, without its marker', () => {
    const content = 'Steps:\n\n- first item\n- second item\n'
    expect(placed(content, 'second item')).toEqual({ start: 23, end: 34 })
  })

  it('places a selection across two list items, as the browser gives it', () => {
    const content = 'Steps:\n\n1. first item\n2. second item\n'
    const at = placed(content, 'first item\nsecond')
    expect(cpSlice(content, at.start, at.end)).toBe('first item\n2. second')
  })

  it('places a selection across a heading and a paragraph', () => {
    const content = '## Title\n\nBody text here.'
    expect(placed(content, 'Title\n\nBody text')).toEqual({ start: 3, end: 19 })
  })

  it('places table cells, which the browser separates with tabs and newlines', () => {
    const content = '| Name | Age |\n|---|---|\n| Ann | 31 |\n| Bob | 42 |'
    const at = placed(content, 'Ann\t31\nBob')
    expect(cpSlice(content, at.start, at.end)).toBe('Ann | 31 |\n| Bob')
  })

  it('places inline code inside bold', () => {
    expect(placed('Use **`npm test`** daily.', 'npm test daily')).toEqual({ start: 7, end: 24 })
  })

  it('places a blockquote line and a struck-through word', () => {
    const content = 'Intro.\n\n> A quote with ~~old~~ new text.'
    const at = placed(content, 'quote with old new')
    expect(cpSlice(content, at.start, at.end)).toBe('quote with ~~old~~ new')
  })

  it('counts code points in a reply too', () => {
    const content = '😀 **Wow**, that worked.'
    const at = placed(content, 'Wow, that')
    expect(at).toEqual({ start: 4, end: 15 })
  })

  it('collapses any whitespace in the selection', () => {
    expect(placed('**bold** text', ' bold \n\t text ')).toEqual({ start: 2, end: 13 })
  })

  it('gives null for text that appears twice (whole-message fallback, never a guess)', () => {
    expect(reply('First the cat sat. Then the cat ran.', 'the cat')).toBeNull()
  })

  it('gives null for text that appears twice once the markdown is gone', () => {
    expect(reply('A **key** point and a key point.', 'key point')).toBeNull()
  })

  it('gives null for text that shows twice only once syntax is hidden (a link URL, a list marker)', () => {
    // Shown as "See the docs now. Read the docs now."
    expect(reply('See [the docs](https://x.com/a) now. Read the docs now.', 'the docs now')).toBeNull()
    // Shown as "Intro\nItem one\nIntro\nItem two": the list marker hides.
    expect(reply('Intro\n\n1. Item one\n\nIntro\n\nItem two', 'Intro\nItem')).toBeNull()
  })

  it('gives null for a selection that is not in the reply', () => {
    expect(reply('Some reply text.', 'other words')).toBeNull()
    expect(reply('Some reply text.', '   ')).toBeNull()
  })

  it('gives null for maths, whose rendered text differs from what is stored', () => {
    const content = 'The area is $\\pi r^2$ here.'
    expect(reply(content, 'πr2')).toBeNull()
    expect(reply(content, 'area is πr2 here')).toBeNull()
    // "r" may be the r of the formula: the reader cannot be told apart.
    expect(reply(content, 'r')).toBeNull()
    expect(reply('Display:\n\n\\[\nx^2 + y^2\n\\]\n\nafter', 'x2+y2')).toBeNull()
  })

  it('still places prose next to maths when it cannot come from the formula', () => {
    const content = 'The area is $\\pi r^2$ here.'
    expect(placed(content, 'The area')).toEqual({ start: 0, end: 8 })
  })

  it('leaves money alone: "$5 or $10" is text, not maths', () => {
    expect(placed('It costs $5 or $10 today.', '$5 or $10')).toEqual({ start: 9, end: 18 })
  })

  it('gives null when the selection could be the code block header (language, Copy)', () => {
    const content = 'Copy this:\n\n```js\nx()\n```'
    expect(reply(content, 'Copy')).toBeNull()
    expect(reply(content, 'js\nCopy\nx()')).toBeNull()
  })

  it('gives null for the header of an indented code block too', () => {
    expect(reply('Intro.\n\n    code here\n\nCopy that.', 'Copy')).toBeNull()
  })

  it('places a selection across the end of a code block, and across blank lines inside one', () => {
    const content = '```python\ndef f():\n    pass\n\n    return 1\n```\n\nAfter it.'
    expect(cpSlice(content, ...span(placedLoose(content, 'pass\n\nreturn 1')))).toBe('pass\n\n    return 1')
    expect(cpSlice(content, ...span(placedLoose(content, 'return 1\nAfter it')))).toBe('return 1\n```\n\nAfter it')
  })

  it('gives null when the selection could be an image label', () => {
    // Shown as "image: a cat and the image."
    expect(reply('![a cat](cat.png) and the image.', 'image')).toBeNull()
    expect(reply('<img src="cat.png" alt="cat"> and the image.', 'image')).toBeNull()
  })

  it('gives null for an HTML entity, which renders as another character', () => {
    expect(reply('Tom &amp; Jerry', 'Tom & Jerry')).toBeNull()
  })

  it('gives null for footnotes, which the renderer numbers and moves', () => {
    expect(reply('A claim[^1] here.\n\n[^1]: The source.', 'claim')).toBeNull()
  })

  it('gives null for a reply with a diagram (its card shows text that is not stored)', () => {
    expect(reply('Look:\n\n```scene\nscene.add(1)\n```\n\nNice.', 'Nice.')).toBeNull()
  })
})

/**
 * Final review finding 1: Reply runs this in a click handler, so a large
 * reply must answer quickly — placed, or null — never freeze the tab. HTML
 * inside a code block is shown as text, so it must not become one long
 * stretch that "may be hidden".
 */
describe('selectionOffsets — large replies stay quick', () => {
  const page = (rows: number) =>
    'Here is the page:\n\n```html\n<html><body>\n' +
    '<div class="row"><p>some text in the rows of the page</p></div>\n'.repeat(rows) +
    '</body></html>\n```\n\nThat is the whole page.'
  const timed = (content: string, selected: string) => {
    const t0 = performance.now()
    const at = reply(content, selected)
    return { at, ms: performance.now() - t0 }
  }

  it('answers within 500 ms for a 50,000-character reply with HTML in a code block', () => {
    const content = page(800)
    expect(content.length).toBeGreaterThan(50_000)
    for (const selected of ['te', 'the page', 'some text']) {
      const { ms } = timed(content, selected)
      expect(ms, `"${selected}"`).toBeLessThan(500)
    }
  })

  it('answers within 500 ms for a 40,000-character reply with a <details> block in prose', () => {
    const content = 'Intro.\n\n<details><summary>More</summary>\n\n' + 'some text in the rows of the page. '.repeat(1200) + '\n\n</details>\n\nDone.'
    expect(content.length).toBeGreaterThan(40_000)
    const { ms } = timed(content, 'te')
    expect(ms).toBeLessThan(500)
  })

  it('still places prose next to an HTML code block, and the tags inside it', () => {
    const content = 'Make the page now.\n\n```html\n<html><body><p>hello</p></body></html>\n```\n\nThat is the whole page.'
    expect(placed(content, 'That is the whole page')).toEqual({ start: 72, end: 94 })
    const at = placedLoose(content, '<p>hello</p>')
    expect(cpSlice(content, at.start, at.end)).toBe('<p>hello</p>')
  })
})

/**
 * The renderer as the oracle: the reply is rendered by the real Markdown
 * component, its text is read roughly the way Selection.toString() reads it,
 * and every run of 1–5 words of that text is "selected". The function may
 * always answer null; it must never answer a span when the selection shows
 * up twice, and a span it gives must show exactly the selected words.
 */
describe('selectionOffsets — against the real renderer', () => {
  const html = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }))
  const decode = (s: string) =>
    s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&amp;/g, '&')
  const shown = (text: string) =>
    decode(
      html(text)
        .replace(/<\/t[dh]>/g, '\t')
        .replace(/<\/(?:p|li|h[1-6]|blockquote|pre|tr|div|ul|ol|table|thead|tbody|button|span)>|<br\s*\/?>/g, '\n')
        .replace(/<[^>]+>/g, ''),
    )
  const count = (hay: string, needle: string) => {
    let n = 0
    for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) n++
    return n
  }
  const squash = (s: string) => shownText(s).replace(/\s/g, '')

  const replies = [
    [
      '# Setup guide',
      '',
      'Run **npm install** first, then `npm test`. Run it *twice* if the setup fails.',
      '',
      '- Install the [setup tool](https://example.com/setup)',
      '- Then run the setup tool',
      '  1. nested step',
      '',
      '| Step | Command |',
      '|:---|---:|',
      '| one | `npm ci` |',
      '| two | npm run build |',
      '',
      '```bash',
      'npm run build',
      'echo "done*"',
      '```',
      '',
      'The area is $\\pi r^2$ and it costs $5 or $10. Also \\(e^{i\\pi}\\) holds.',
      '',
      '> A quote with ~~old~~ new text and <kbd>Ctrl</kbd> keys.',
      '',
      'Done &amp; dusted. ![diagram](d.png) Copy that image, then copy the build.',
    ].join('\n'),
    [
      'The model said the model is fine.',
      '',
      '## The model',
      '',
      '1. First **the model** loads',
      '2. Then the `model` runs',
      '',
      '***',
      '',
      'Setext heading',
      '--------------',
      '',
      'Final line with a [ref link][r] and a <https://auto.link/x> plus www.example.com.',
      '',
      '[r]: https://ref.example.com/the-model',
    ].join('\n'),
    [
      'Intro line with text to copy.',
      '',
      '    indented code here',
      '',
      '- item one',
      '    - nested item',
      '> quoted line',
      '',
      '```python',
      'class A:',
      '    def f(self):',
      '        pass',
      '',
      '    def g(self):',
      '        return 1',
      '```',
      '',
      'After the code, <details><summary>More</summary>hidden text</details> end with $$a+b$$ and \\[c\\].',
    ].join('\n'),
  ]

  for (const [n, content] of replies.entries()) {
    it(`never places a selection wrongly (reply ${n + 1})`, () => {
      const text = ws(shown(content))
      const words = text.split(' ')
      const selections = new Set<string>()
      for (let len = 1; len <= 5; len++) {
        for (let i = 0; i + len <= words.length; i++) selections.add(words.slice(i, i + len).join(' '))
      }
      // Bare words too ("image" out of "image:"), and the letters of each word one by one.
      for (const word of words) {
        selections.add(word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
        for (const c of word) selections.add(c)
      }
      selections.delete('')
      let placedCount = 0
      for (const selected of selections) {
        const at = reply(content, selected)
        if (!at) continue
        placedCount++
        expect(count(text, selected), `"${selected}" shows more than once`).toBe(1)
        expect(squash(cpSlice(content, at.start, at.end)), `"${selected}" placed at the wrong text`).toBe(
          squash(selected),
        )
      }
      // Not vacuous: plenty of selections are placed.
      expect(placedCount).toBeGreaterThan(20)
    })
  }
})
