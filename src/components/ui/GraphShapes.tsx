'use client'

/**
 * The two graph shapes, side by side: the usual one and this one.
 *
 * Shared, because both tours make the same argument and a diagram that drifts
 * between two surfaces argues for two different products.
 *
 * Geometry is spaced so nothing overlaps — the chats end at x 64 and 136, the
 * concept runs 66 to 134 between them, and the two rows are 12 apart. An
 * overlapping diagram argues against the claim it is drawn to make.
 */

function Dot({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <>
      <circle cx={x} cy={y} r="14" fill="var(--white)" stroke="var(--pill-border)" />
      <text x={x} y={y + 3.5} textAnchor="middle" fontSize="9" fill="var(--ink3)">
        {label}
      </text>
    </>
  )
}

export function IdeaToIdea() {
  return (
    <svg viewBox="0 0 200 104" role="img" aria-label="Four ideas joined to each other by inferred links">
      <g stroke="var(--line-quiet)" strokeWidth="1.5" strokeDasharray="3 3">
        <line x1="44" y1="30" x2="110" y2="26" />
        <line x1="110" y1="26" x2="156" y2="62" />
        <line x1="44" y1="30" x2="72" y2="78" />
        <line x1="72" y1="78" x2="156" y2="62" />
        <line x1="110" y1="26" x2="72" y2="78" />
      </g>
      <Dot x={44} y={30} label="idea" />
      <Dot x={110} y={26} label="idea" />
      <Dot x={72} y={78} label="idea" />
      <Dot x={156} y={62} label="idea" />
    </svg>
  )
}

export function ChatToConcept() {
  return (
    <svg
      viewBox="0 0 200 104"
      role="img"
      aria-label="Two conversations both joined to one shared concept between them"
    >
      <g stroke="var(--line-strong)" strokeWidth="1.8">
        <line x1="36" y1="40" x2="100" y2="54" />
        <line x1="164" y1="40" x2="100" y2="54" />
      </g>
      <g fill="var(--white)" stroke="var(--pill-border)">
        <rect x="8" y="14" width="56" height="26" rx="6" />
        <rect x="136" y="14" width="56" height="26" rx="6" />
      </g>
      <g textAnchor="middle" fontSize="9" fill="var(--ink3)">
        <text x="36" y="30.5">chat</text>
        <text x="164" y="30.5">chat</text>
      </g>
      <rect x="66" y="52" width="68" height="24" rx="12" fill="var(--violet)" />
      <text x="100" y="67.5" textAnchor="middle" fontSize="9" fontWeight="600" fill="#fff">
        concept
      </text>
      <text x="100" y="94" textAnchor="middle" fontSize="9" fill="var(--violet)">
        both of them said it
      </text>
    </svg>
  )
}

/** The pair, with the captions that make the comparison land. */
export function ShapeComparison() {
  return (
    <div className="tour-compare">
      <div className="tour-panel">
        <h3>The usual knowledge graph</h3>
        <IdeaToIdea />
        <p>A model reads your notes and decides which ideas are related.</p>
      </div>
      <div className="tour-panel is-ours">
        <h3>Minddyte</h3>
        <ChatToConcept />
        <p>A conversation links only to concepts actually said in it.</p>
      </div>
    </div>
  )
}
