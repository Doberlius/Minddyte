'use client'

import { useState, type ReactNode } from 'react'

type CopyState = 'idle' | 'copied' | 'failed'

/**
 * A fenced code block, the way Claude shows one: a header with the language
 * and a Copy button, then the code — coloured by rehype-highlight, scrolling
 * sideways instead of wrapping, so a long config line stays one line.
 *
 * `code` is the block's plain text, which is what Copy puts on the clipboard;
 * `children` is the highlighted `<code>` element that is shown.
 */
export function CodeBlock({ language, code, children }: { language: string; code: string; children: ReactNode }) {
  const [state, setState] = useState<CopyState>('idle')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setState('copied')
    } catch {
      // The clipboard API needs a secure page and the user's permission.
      setState('failed')
    }
    setTimeout(() => setState('idle'), 2000)
  }

  return (
    <div className="codeblock">
      <div className="codeblock-head">
        <span className="codeblock-lang">{language}</span>
        <button
          type="button"
          className="codeblock-copy"
          onClick={copy}
          aria-label={state === 'idle' ? `Copy ${language} code` : undefined}
        >
          {state === 'copied' ? 'Copied' : state === 'failed' ? 'Couldn’t copy' : 'Copy'}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  )
}
