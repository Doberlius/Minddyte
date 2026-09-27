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
