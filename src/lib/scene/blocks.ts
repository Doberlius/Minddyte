/**
 * Scene blocks in a markdown message: fenced blocks whose info string is
 * exactly `scene`. A fence opens with ``` or ~~~ (3+), up to 3 spaces of
 * indent, and closes with the same character, at least as long, alone on its
 * line. Offsets are UTF-16 indices into the message (what String.slice takes).
 */
export type SceneBlock = { code: string; start: number; end: number }

const OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/

type Line = { text: string; start: number; end: number } // end excludes the line break

function lines(md: string): Line[] {
  const out: Line[] = []
  let at = 0
  for (const raw of md.split('\n')) {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    out.push({ text, start: at, end: at + text.length })
    at += raw.length + 1
  }
  return out
}

export function findSceneBlocks(markdown: string): SceneBlock[] {
  const ls = lines(markdown)
  const blocks: SceneBlock[] = []
  let open: { fence: string; scene: boolean; line: number } | null = null
  for (let i = 0; i < ls.length; i++) {
    const m = ls[i].text.match(OPEN)
    if (!open) {
      if (m) open = { fence: m[2], scene: m[3].trim() === 'scene', line: i }
      continue
    }
    const closes = m && m[2][0] === open.fence[0] && m[2].length >= open.fence.length && m[3].trim() === ''
    if (!closes) continue
    if (open.scene) {
      const body = ls.slice(open.line + 1, i).map((l) => l.text)
      blocks.push({ code: body.join('\n'), start: ls[open.line].start, end: ls[i].end })
    }
    open = null
  }
  return blocks
}

/** The message with only the index-th scene block's code replaced; null if there is no such block. */
export function replaceSceneBlock(markdown: string, index: number, code: string): string | null {
  const block = findSceneBlocks(markdown)[index]
  if (!block) return null
  const original = markdown.slice(block.start, block.end)
  const firstBreak = original.indexOf('\n')
  const lastBreak = original.lastIndexOf('\n')
  const openLine = original.slice(0, firstBreak).replace(/\r$/, '')
  const closeLine = original.slice(lastBreak + 1)
  const eol = original.slice(0, firstBreak).endsWith('\r') ? '\r\n' : '\n'
  const body = code.replace(/\r?\n/g, eol)
  return markdown.slice(0, block.start) + openLine + eol + body + eol + closeLine + markdown.slice(block.end)
}

/** Code that is safe to put inside ONE scene block: not empty, no line that could be a fence. */
export function isSingleSceneBody(code: string): boolean {
  return code.trim() !== '' && !/^ {0,3}(`{3,}|~{3,})/m.test(code)
}

/** The first scene block's code in a model's reply, or null. */
export function extractSceneCode(modelText: string): string | null {
  return findSceneBlocks(modelText)[0]?.code ?? null
}
