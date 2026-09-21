'use client'

import { RECORD_SEPARATOR, COMPACTION_CAP } from '@/lib/compaction'

/**
 * What just happened, in the product's own terms.
 *
 * A visitor who types a sentence that connects to nothing would otherwise see
 * an unchanged canvas and conclude the demo is broken. It is not — the
 * extractor ran, the shape gate made a decision, and a Node was created. This
 * panel shows that work, so every message produces visible evidence whether or
 * not an edge happened to appear.
 */

export type Extraction = {
  /** Concepts that became Nodes. */
  auto: string[]
  /** Concepts that matched a Node the graph already held. */
  connected: string[]
  /** Concepts the shape gate would only ever suggest. */
  suggested: string[]
}

function Chip({
  children,
  tone,
}: {
  children: React.ReactNode
  tone: 'linked' | 'new' | 'muted'
}) {
  const palette = {
    linked: { bg: 'var(--violet)', fg: '#fff', br: 'var(--violet)' },
    new: { bg: 'var(--violet-l)', fg: 'var(--violet)', br: 'var(--violet-m)' },
    muted: { bg: 'var(--white)', fg: 'var(--ink3)', br: 'var(--border)' },
  }[tone]

  return (
    <span
      style={{
        fontSize: 11,
        padding: '3px 9px',
        borderRadius: 999,
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.br}`,
        fontWeight: tone === 'muted' ? 400 : 600,
      }}
    >
      {children}
    </span>
  )
}

function Legend({
  swatch,
  children,
}: {
  swatch: 'card' | 'shared' | 'lone'
  children: React.ReactNode
}) {
  const style = {
    card: { background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 4 },
    shared: { background: 'var(--violet-l)', border: '1px solid var(--violet-m)', borderRadius: 999 },
    lone: { background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 999 },
  }[swatch]

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span style={{ ...style, width: 18, height: 12, flexShrink: 0, marginTop: 2 }} />
      <span style={{ fontSize: 11.5, color: 'var(--ink2)', lineHeight: 1.5 }}>{children}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '.07em',
          color: 'var(--ink3)',
          marginBottom: 7,
          fontWeight: 600,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

export function Readout({
  extraction,
  compaction,
}: {
  extraction: Extraction | null
  compaction: string
}) {
  const sentences = compaction.split(RECORD_SEPARATOR).filter(Boolean)
  const linked = new Set(extraction?.connected ?? [])

  return (
    <div>
      {/* Before anything has been sent the panel would otherwise be two empty
          headings, and a visitor cannot tell what they are looking at. */}
      {!extraction && (
        <Section title="How to read the canvas">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <Legend swatch="card">
              A conversation. Its name is taken from its own first sentence.
            </Legend>
            <Legend swatch="shared">
              A concept two or more conversations mention. The number is how many.
            </Legend>
            <Legend swatch="lone">A concept only one conversation mentions so far.</Legend>
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: 'var(--ink2)',
              marginTop: 11,
              lineHeight: 1.6,
            }}
          >
            Nobody filed any of this. Send a message naming one of those
            technologies and watch your conversation join the graph.
          </div>
        </Section>
      )}

      {extraction && (
        <Section title="What the extractor found">
          {extraction.auto.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.6 }}>
              Nothing firm enough to index.
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {extraction.auto.map((label) => (
                <Chip key={label} tone={linked.has(label) ? 'linked' : 'new'}>
                  {label}
                  {linked.has(label) && ' ·  linked'}
                </Chip>
              ))}
            </div>
          )}

          {extraction.suggested.length > 0 && (
            <div style={{ marginTop: 9 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {extraction.suggested.map((label) => (
                  <Chip key={label} tone="muted">
                    {label}
                  </Chip>
                ))}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--ink3)',
                  marginTop: 6,
                  lineHeight: 1.55,
                }}
              >
                Held back, not indexed. A plain lowercase word is right only 29% of
                the time, so it is offered rather than assumed.
              </div>
            </div>
          )}
        </Section>
      )}

      <Section title={`Memory of your conversation · ${compaction.length}/${COMPACTION_CAP} chars`}>
        {sentences.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--ink3)', lineHeight: 1.6 }}>
            Empty until you send something.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sentences.map((s, i) => (
              <div
                key={i}
                style={{
                  fontSize: 12,
                  lineHeight: 1.55,
                  color: 'var(--ink2)',
                  paddingLeft: 9,
                  borderLeft: '2px solid var(--violet-m)',
                }}
              >
                {s}
              </div>
            ))}
          </div>
        )}
        <div
          style={{
            fontSize: 11,
            color: 'var(--ink3)',
            marginTop: 9,
            lineHeight: 1.55,
          }}
        >
          Sentences taken verbatim, newest first, never rewritten. This is exactly
          what the assistant receives when this conversation is tagged into
          another one.
        </div>
      </Section>
    </div>
  )
}
