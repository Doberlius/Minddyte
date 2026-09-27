'use client'

import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { common } from 'lowlight'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import nginx from 'highlight.js/lib/languages/nginx'
import type { Element, ElementContent } from 'hast'
import { CodeBlock } from './CodeBlock'

/**
 * A model reply, rendered as markdown: headings, lists, tables (GFM), quotes,
 * links, inline code and Claude-style code blocks.
 *
 * Safe by default: react-markdown never renders raw HTML from the text
 * (there is no rehype-raw here), and it drops `javascript:` link targets.
 *
 * Code is coloured by highlight.js's common set of ~37 languages, plus
 * Dockerfile and nginx, which the user's chats use. Passing `languages`
 * REPLACES rehype-highlight's default set, so `common` is spread in first.
 * A block with no language is not guessed at (`detect` is off): guesses are
 * often wrong, and guessing costs time on long replies.
 */
const HIGHLIGHT = [rehypeHighlight, { languages: { ...common, dockerfile, nginx }, detect: false }] as const

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
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[HIGHLIGHT as never]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
