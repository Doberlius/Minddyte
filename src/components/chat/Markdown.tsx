'use client'

import { createContext, useContext, useMemo } from 'react'
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
import { findSceneBlocks, type SceneBlock } from '@/lib/scene/blocks'
import { LIMITS } from '@/scene/types'
import { CodeBlock } from './CodeBlock'
import { ScenePlayer } from './ScenePlayer'

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
  [rehypeHighlight, { languages: { ...common, dockerfile, nginx }, detect: false, plainText: ['scene'] }],
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

/**
 * The reply's CLOSED scene blocks (spec §6), found once per render and read
 * by `ScenePre` through context rather than being baked into a per-render
 * `components` object.
 *
 * That distinction matters: react-markdown (hast-util-to-jsx-runtime) uses
 * `components.pre` as a React component TYPE, not a value it calls. A new
 * function identity is a different type to React, and a different type means
 * unmount-then-remount, not update. `components` used to be built by a
 * `componentsFor(text)` factory called from `useMemo(() => componentsFor(text),
 * [text])` — a fresh `pre` function every time `text` changed. While a reply is
 * streaming, `text` changes on every token, so every scene block that had
 * already closed and mounted its `ScenePlayer` was torn down and rebuilt (a
 * new iframe, a new worker, a new ready/render/done round trip) on every
 * single token after it. `components` is a module-level constant again so
 * `pre`'s identity never changes; only the scenes it can see, via context, do.
 */
const SceneBlocksContext = createContext<SceneBlock[]>([])

/**
 * `pre` for one fenced block. A `scene` block is matched to its `SceneBlock`
 * by POSITION (`node.position.start.offset`), not by comparing code text —
 * two blocks with identical code must still get their own, different index
 * (repair, Task 7, addresses a block by this index).
 *
 * The offset is into the string `Markdown` actually gave `ReactMarkdown`
 * (`normalizeMath(text)`), which is also what `scenes` was computed from, so
 * the two agree. That string can differ from the raw stored message in
 * length (LaTeX delimiters get rewritten), but never inside a fenced block —
 * `normalizeMath` passes fence lines through untouched — so it can never
 * add, remove or reorder a scene block; the Nth scene block here is always
 * the Nth scene block in `findSceneBlocks(<raw stored text>)`, which is what
 * the repair endpoint re-parses.
 */
const ScenePre: NonNullable<Components['pre']> = ({ node, children }) => {
  const scenes = useContext(SceneBlocksContext)
  const code = node?.children.find((c): c is Element => c.type === 'element' && c.tagName === 'code')
  if (!code) return <pre>{children}</pre>
  const language = languageOf(code)
  const plain = textOf(code).replace(/\n$/, '')
  if (language === 'scene') {
    const offset = node?.position?.start.offset
    const index = scenes.findIndex((b) => offset !== undefined && b.start <= offset && offset < b.end)
    // Closed scene blocks only: a block still streaming has no closing fence
    // yet (no match here) and must never run half-written code.
    if (index === -1) return <div className="scene-card is-pending">Drawing…</div>
    if (index < LIMITS.scenesPerReply) return <ScenePlayer code={scenes[index].code} index={index} />
  }
  // `children` is the <code> element react-markdown already built, with
  // the highlighted spans inside; the block wraps it as it is.
  return (
    <CodeBlock language={language} code={plain}>
      {children}
    </CodeBlock>
  )
}

/**
 * Exported so a test can assert its identity is stable across renders — the
 * whole point of pulling `pre` out of a per-text factory (see `ScenePre`'s
 * comment above).
 */
export const markdownComponents: Components = {
  pre: ScenePre,
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
  const source = normalizeMath(text)
  const scenes = useMemo(() => findSceneBlocks(source), [source])
  return (
    <div className="md">
      <SceneBlocksContext.Provider value={scenes}>
        <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={markdownComponents}>
          {source}
        </ReactMarkdown>
      </SceneBlocksContext.Provider>
    </div>
  )
}
