/**
 * The ONE list of chat commands that work — read by both the / menu and the
 * /help card, so the two can never disagree (ticket 08, Q10). Plain words
 * only: a first-time visitor must understand each line at once.
 *
 * src/constants/commands.ts is a different thing: ideas for commands that
 * are NOT built. Nothing here reads it.
 */
export type ChatMode = 'focus' | 'explore'
export type CommandAction = { kind: 'mode'; mode: ChatMode } | { kind: 'help' } | { kind: 'forget' }
export type HelpEntry = { name: string; label: string; what: string; example: string; action?: CommandAction }

export const HELP_ENTRIES: HelpEntry[] = [
  {
    name: 'mode explore', label: '/mode explore',
    what: 'Also look in related chats, and use general knowledge. This is the default.',
    example: '/mode explore, then: how does Kafka keep messages in order?',
    action: { kind: 'mode', mode: 'explore' },
  },
  {
    name: 'mode focus', label: '/mode focus',
    what: 'Answer only from this chat and the chats you add with @. If the answer is not there, it says so.',
    example: '/mode focus, then: @Muse Code what does it do?',
    action: { kind: 'mode', mode: 'focus' },
  },
  {
    name: '@', label: '@',
    what: 'Add another chat to this one, so its conversation is used.',
    example: '@Muse Code compare it with Copilot',
  },
  {
    name: 'about you', label: 'About you',
    what: 'A short note about you that every answer can use. Only you can change it.',
    example: 'Main language: TypeScript. Project: Minddyte.',
  },
  {
    name: 'forget', label: '/forget',
    what: 'Stop a concept in this chat from being used as memory. The messages stay, and you can still read them.',
    example: '/forget, then pick Kafka',
    action: { kind: 'forget' },
  },
  {
    name: 'help', label: '/help',
    what: 'Show this list of commands.',
    example: '/help',
    action: { kind: 'help' },
  },
]

export const SLASH_ENTRIES = HELP_ENTRIES.filter((e) => e.action)

export function matchCommands(query: string): HelpEntry[] {
  const q = query.toLowerCase()
  return SLASH_ENTRIES.filter((e) => e.name.startsWith(q) || e.name.includes(q))
}

/**
 * The command a whole message IS, if any: `/help`, `/mode focus`, ignoring case
 * and surrounding spaces. Send runs it instead of sending it, so a command is
 * never sent to the model and never saved (ticket 08, Q10). "/help me with
 * kafka" is a message, not a command.
 */
export function exactCommand(text: string): HelpEntry | undefined {
  const t = text.trim().toLowerCase()
  return SLASH_ENTRIES.find((e) => e.label.toLowerCase() === t)
}

/**
 * The one place that spells out a mode for a person to read (Q9): every spot
 * that shows the current mode — the composer's button and its aria-label,
 * the chat header — calls this instead of showing the raw `'focus'` /
 * `'explore'` value, so they can never drift apart.
 */
export function modeLabel(mode: ChatMode): string {
  return mode === 'focus' ? 'Focus' : 'Explore'
}
