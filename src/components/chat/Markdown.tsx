'use client'

import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { common } from 'lowlight'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import nginx from 'highlight.js/lib/languages/nginx'
import type { Element, ElementContent } from 'hast'
import type { PluggableList } from 'unified'
import 'katex/dist/katex.min.css'
import { normalizeMath } from '@/lib/math'
import { CodeBlock } from './CodeBlock'

/**
 * A model reply, rendered as markdown: headings, lists, tables (GFM), quotes,
 * links, inline code, LaTeX and Claude-style code blocks.
 *
 * HTML in a reply is parsed (rehype-raw) and then cleaned against GitHub's
 * allow-list (rehype-sanitize's default schema): <br> in a table cell, <sup>,
 * <sub>, <b>, <kbd> and <details> work; <script>, <style>, <iframe>, event
 * handlers and javascript: links are removed, not shown. Images are never
 * loaded — stricter than GitHub, see `img` below. The ORDER is the
 * safety: cleaning runs first, and only then do KaTeX and highlight.js add
 * their own markup, so the cleaner never has to trust anything the model sent.
 *
 * LaTeX: normalizeMath rewrites $…$, \(…\) and \[…\] to $$…$$ (money and code
 * left alone), so remark-math runs with single-dollar maths off. Maths keeps
 * its `language-math` class through the cleaner, which is all rehype-katex
 * needs; broken LaTeX shows as red source instead of failing the reply.
 *
 * Code is coloured by highlight.js's common set of ~37 languages, plus
 * Dockerfile and nginx, which the user's chats use. Passing `languages`
 * REPLACES rehype-highlight's default set, so `common` is spread in first.
 * A block with no language is not guessed at (`detect` is off): guesses are
 * often wrong, and guessing costs time on long replies.
 */
const REMARK: PluggableList = [remarkGfm, [remarkMath, { singleDollarTextMath: false }]]
const REHYPE: PluggableList = [
  rehypeRaw,
  rehypeSanitize,
  [rehypeKatex, { throwOnError: false, errorColor: '#B91C1C' }],
  [rehypeHighlight, { languages: { ...common, dockerfile, nginx }, detect: false }],
]

/** The plain text of a hast node: what Copy puts on the clipboard. */
function textOf(node: ElementContent): string {
  if (node.type === 'text') return node.value
  if (node.type === 'element') return node.children.map(textOf).join('')
  return ''
}

/** `language-python` → `python`; no language → `text`. */
function languageOf(code: Element): string {
  const classes = code.properties.className
  const list = Array.isArray(classes) ? classes.map(String) : []
  const found = list.find((c) => c.startsWith('language-'))
  return found ? found.slice('language-'.length) : 'text'
}

const components: Components = {
  pre({ node, children }) {
    const code = node?.children.find((c): c is Element => c.type === 'element' && c.tagName === 'code')
    if (!code) return <pre>{children}</pre>
    // `children` is the <code> element react-markdown already built, with
    // the highlighted spans inside; the block wraps it as it is.
    return (
      <CodeBlock language={languageOf(code)} code={textOf(code).replace(/\n$/, '')}>
        {children}
      </CodeBlock>
    )
  },
  // Column alignment lives on the th/td cells, so the table needs only its rows.
  table({ children }) {
    return (
      <div className="md-table">
        <table>{children}</table>
      </div>
    )
  },
  // A reply never LOADS an image: showing one fetches its URL at once, and a
  // manipulated reply can put the conversation into that URL. A web image is
  // offered as a link the user can choose to open; anything else is its text.
  img({ src, alt }) {
    const label = `image: ${alt || 'untitled'}`
    return (
      <span className="md-img">
        {typeof src === 'string' && /^https?:\/\//i.test(src) ? (
          <a href={src} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        ) : (
          label
        )}
      </span>
    )
  },
  a({ href, title, children }) {
    return (
      <a href={href} title={title} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  },
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={components}>
        {normalizeMath(text)}
      </ReactMarkdown>
    </div>
  )
}
