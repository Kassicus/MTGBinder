/** A run of inline text in Claude's Markdown (spec §5.5): plain, bold, italic, code, a link, or a [[card]] link. */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'card'; name: string }
  | { kind: 'link'; href: string; children: Inline[] }

/** A block of Claude's Markdown. Anything the parser doesn't know stays as paragraph text. */
export type Block =
  | { kind: 'paragraph'; content: Inline[] }
  | { kind: 'heading'; level: number; content: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { kind: 'rule' }

// Tried in this order at each position; the earliest match wins, then the longest.
const INLINE: Array<{ re: RegExp; make: (m: RegExpExecArray) => Inline }> = [
  { re: /`([^`\n]+)`/, make: (m) => ({ kind: 'code', text: m[1]! }) },
  // A card's name and a link's text hold no brackets, so each "[" of a long run fails at once instead of scanning on.
  { re: /\[\[([^\[\]\n]{1,150})\]\]/, make: (m) => ({ kind: 'card', name: m[1]!.trim() }) },
  { re: /\[([^\[\]\n]+)\]\((https?:\/\/[^\s)]+)\)/, make: (m) => ({ kind: 'link', href: m[2]!, children: parseInline(m[1]!) }) },
  // Emphasis markers hug their text, as in CommonMark: "2 * 3 * 4" stays text.
  { re: /\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*/, make: (m) => ({ kind: 'strong', children: parseInline(m[1]!) }) },
  { re: /__(?!\s)([^_\n]+?)(?<!\s)__/, make: (m) => ({ kind: 'strong', children: parseInline(m[1]!) }) },
  { re: /(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/, make: (m) => ({ kind: 'em', children: parseInline(m[1]!) }) },
  { re: /(?<!\w)_(?!\s)([^_\n]+?)(?<!\s)_(?!\w)/, make: (m) => ({ kind: 'em', children: parseInline(m[1]!) }) },
]

/** Parses bold, italic, inline code, http(s) links, and [[Card Name]] links; everything else is text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let rest = text
  while (rest !== '') {
    let best: { index: number; length: number; node: Inline } | null = null
    for (const { re, make } of INLINE) {
      const m = re.exec(rest)
      if (m && (best === null || m.index < best.index || (m.index === best.index && m[0].length > best.length))) {
        best = { index: m.index, length: m[0].length, node: make(m) }
      }
    }
    if (!best) {
      out.push({ kind: 'text', text: rest })
      break
    }
    if (best.index > 0) out.push({ kind: 'text', text: rest.slice(0, best.index) })
    out.push(best.node)
    rest = rest.slice(best.index + best.length)
  }
  return out
}

const HEADING = /^(#{1,6})\s+(.*)$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => parseInline(cell.trim()))

/** Parses the Markdown Claude writes: paragraphs, headings, lists, fenced code, tables, and rules. */
export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '') {
      i++
      continue
    }
    if (line.trimStart().startsWith('```')) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trimStart().startsWith('```')) body.push(lines[i++]!)
      i++ // the closing fence (or the end)
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]!.length, content: parseInline(heading[2]!.trim()) })
      i++
      continue
    }
    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' })
      i++
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1]!)) {
      const head = cells(line)
      const rows: Inline[][][] = []
      i += 2
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') rows.push(cells(lines[i++]!))
      blocks.push({ kind: 'table', head, rows })
      continue
    }
    const listItem = BULLET.exec(line) ?? NUMBERED.exec(line)
    if (listItem) {
      const ordered = !BULLET.test(line)
      const items: string[] = []
      while (i < lines.length) {
        const current = lines[i]!
        const item = (ordered ? NUMBERED : BULLET).exec(current)
        if (item) items.push(item[1]!)
        else if (current.trim() !== '' && /^\s+/.test(current) && items.length > 0) items[items.length - 1] += ` ${current.trim()}`
        else break
        i++
      }
      blocks.push({ kind: 'list', ordered, items: items.map((item) => parseInline(item)) })
      continue
    }
    const paragraph: string[] = []
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !HEADING.test(lines[i]!) &&
      !BULLET.test(lines[i]!) &&
      !NUMBERED.test(lines[i]!) &&
      !lines[i]!.trimStart().startsWith('```')
    ) {
      paragraph.push(lines[i++]!.trim())
    }
    blocks.push({ kind: 'paragraph', content: parseInline(paragraph.join('\n')) })
  }
  return blocks
}
