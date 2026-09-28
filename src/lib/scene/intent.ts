/**
 * Does this message ask for a diagram? A word check, not a model call
 * (spec §3). "graph" and "plot" are deliberately absent: this app talks about
 * knowledge graphs, and "the plot of Hamlet" is not a request to draw.
 */
const COMMAND = /^\s*\/visualize\b/i
const ASKS_TO_SEE = /\b(show me|visuali[sz]e|animate|illustrate|draw (me |a |an )?|diagrams?)\b/i

export function wantsDiagram(message: string): boolean {
  return COMMAND.test(message) || ASKS_TO_SEE.test(message)
}

/** The text memory reads: the leading /visualize word is a command, not a concept. */
export function stripVisualize(message: string): string {
  return COMMAND.test(message) ? message.replace(/^\s*\/visualize\b\s*/i, '') : message
}

/**
 * The text pointers are built from: same length as the STORED message, so
 * every offset `stripVisualize`'s shorter text would produce still lands on
 * the same character in the row the database actually has. The command word
 * (and any leading whitespace before it) is replaced rather than removed, so
 * nothing after it shifts.
 *
 * The filler is NOT a space run, on purpose. `/visualize` is 10 characters,
 * so blanking it to spaces puts 10+ leading spaces at the very start of the
 * message — which CommonMark reads as an indented code block, swallowing the
 * entire first paragraph (every sentence in it) into one opaque `code` span
 * instead of per-sentence pointers. A digit run carries no Markdown meaning
 * at the start of a line (unlike `#`, `-`/`*`/`_`, or 4+ spaces) and keeps
 * remark parsing the rest of the message exactly as it would unblanked.
 */
export function blankVisualize(message: string): string {
  return message.replace(/^(\s*\/visualize\b)/i, (m) => '0'.repeat(m.length))
}
