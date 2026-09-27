import { describe, it, expect } from 'vitest'
import { normalizeMath, splitMath } from '@/lib/math'

/**
 * Models write LaTeX four ways: $…$, $$…$$, \(…\) and \[…\]. remark-math
 * reads only dollars, and a bare $ is also money ("costs $5 and $10"). So
 * every form is rewritten to $$…$$ before parsing, a single $ only when it
 * follows Pandoc's rule, and code is never touched.
 */
describe('normalizeMath', () => {
  it('turns inline $…$ into $$…$$', () => {
    expect(normalizeMath('Energy is $E = mc^2$ here.')).toBe('Energy is $$E = mc^2$$ here.')
  })

  it('handles a one-character formula', () => {
    expect(normalizeMath('let $x$ be')).toBe('let $$x$$ be')
  })

  it('converts the bullets in a table cell, next to <br>', () => {
    expect(normalizeMath('| $\\bullet$ one.<br>$\\bullet$ two. |')).toBe('| $$\\bullet$$ one.<br>$$\\bullet$$ two. |')
  })

  it('leaves money alone', () => {
    expect(normalizeMath('It costs $5 and $10.')).toBe('It costs $5 and $10.')
    expect(normalizeMath('Between $5-$10 a month.')).toBe('Between $5-$10 a month.')
    expect(normalizeMath('Only $20.')).toBe('Only $20.')
  })

  it('leaves an escaped dollar alone', () => {
    expect(normalizeMath('a \\$5 fee and \\$6 tax')).toBe('a \\$5 fee and \\$6 tax')
  })

  it('leaves $$…$$ as it is', () => {
    expect(normalizeMath('sum $$\\sum_i i$$ done')).toBe('sum $$\\sum_i i$$ done')
    expect(normalizeMath('$$\nx^2\n$$')).toBe('$$\nx^2\n$$')
  })

  it('turns \\(…\\) into inline math', () => {
    expect(normalizeMath('so \\(a^2+b^2\\) holds')).toBe('so $$a^2+b^2$$ holds')
  })

  it('turns \\[…\\] into display math on its own lines', () => {
    expect(normalizeMath('see \\[x = \\sqrt{2}\\] here')).toBe('see \n$$\nx = \\sqrt{2}\n$$\n here')
  })

  it('never touches a fenced code block', () => {
    const code = '```bash\necho $HOME $PATH\nprice=$5\n```'
    expect(normalizeMath(code)).toBe(code)
    expect(normalizeMath(`$x$ before\n${code}\nafter $y$`)).toBe(`$$x$$ before\n${code}\nafter $$y$$`)
  })

  it('never touches inline code', () => {
    expect(normalizeMath('run `echo $x$` then $y$')).toBe('run `echo $x$` then $$y$$')
  })
})

describe('splitMath (stored sentences)', () => {
  it('finds inline math and keeps the words around it', () => {
    expect(splitMath('$\\bullet$ Integration with Poultry Max.')).toEqual([
      { text: '\\bullet', math: true },
      { text: ' Integration with Poultry Max.' },
    ])
  })

  it('finds every delimiter form', () => {
    expect(splitMath('a \\(x\\) b $$y$$ c \\[z\\] d $w$').filter((p) => p.math).map((p) => p.text)).toEqual(['x', 'y', 'z', 'w'])
  })

  it('leaves money and code as text', () => {
    expect(splitMath('It costs $5 and $10, see `$x$`.')).toEqual([{ text: 'It costs $5 and $10, see `$x$`.' }])
  })
})
