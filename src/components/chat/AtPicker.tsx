'use client'

type Chat = { id: string; title: string; nodeCount: number }

export function AtPicker({ chats, query, onPick }: {
  chats: Chat[]
  query: string
  onPick: (chat: Chat) => void
}) {
  const q = query.toLowerCase()
  const list = chats.filter((c) => c.title.toLowerCase().includes(q))

  if (list.length === 0) {
    return (
      <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, background: 'var(--white)',
        border: '1px solid var(--border)', borderRadius: 10, padding: 16, fontSize: 12, color: 'var(--ink3)' }}>
        No chats match “{query}”. Only past chats can be brought in.
      </div>
    )
  }

  return (
    <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, background: 'var(--white)',
      border: '1px solid var(--border)', borderRadius: 10, maxHeight: 260, overflowY: 'auto', zIndex: 30 }}>
      <div style={{ padding: '8px 13px', borderBottom: '1px solid var(--border)', fontSize: 10,
        textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--ink3)' }}>
        Bring in a chat — loads its memory into this message
      </div>
      {list.map((c) => (
        <div key={c.id} onClick={() => onPick(c)}
          style={{ padding: '9px 13px', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>{c.title}</div>
          <div style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--ink3)' }}>{c.nodeCount} concepts</div>
        </div>
      ))}
    </div>
  )
}
