'use client'

type Chat = { id: string; title: string; nodeCount: number }

/**
 * The `@` list: past conversations you can bring into this message.
 *
 * Shares the `.picker` shell with the `/` command list. Two panels opening in
 * the same place that look unlike each other read as two mechanisms rather
 * than one box that understands two prefixes.
 */
export function AtPicker({ chats, query, onPick }: {
  chats: Chat[]
  query: string
  onPick: (chat: Chat) => void
}) {
  const q = query.toLowerCase()
  const list = chats.filter((c) => c.title.toLowerCase().includes(q))

  if (list.length === 0) {
    return (
      <div className="picker">
        <div className="picker-head">Bring in a chat</div>
        <p className="picker-empty">
          No chat matches “{query}”. Only a past conversation can be brought in.
        </p>
      </div>
    )
  }

  return (
    <div className="picker" role="listbox" aria-label="Past conversations">
      <div className="picker-head">Bring in a chat — loads its memory into this message</div>
      {list.map((c) => (
        <div key={c.id} className="at-row" role="option" aria-selected={false} onClick={() => onPick(c)}>
          <span className="t">{c.title}</span>
          <span className="m tnum">{c.nodeCount} concepts</span>
        </div>
      ))}
    </div>
  )
}
