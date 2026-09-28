import type { Board } from './types.ts'

/** One card line from a pasted decklist. */
export interface DecklistEntry {
  /** Line in the pasted text, from 1. */
  line: number
  quantity: number
  name: string
  /** Set code and collector number, when the line names a printing (Arena and Moxfield do). */
  setCode: string | null
  collectorNumber: string | null
  board: Board
}

export interface ParsedDecklist {
  entries: DecklistEntry[]
  /** Lines that aren't a card, a section heading, or a comment. */
  skipped: Array<{ line: number; text: string }>
}

/** Where a section's lines go: a board, the companion (held for the sideboard), or nowhere (null skips the section). */
type Section = Board | 'companion' | null

/** Section headings (compared lowercase, without a count or colon). */
const SECTIONS: Record<string, Section> = {
  commander: 'commander',
  commanders: 'commander',
  deck: 'main',
  main: 'main',
  mainboard: 'main',
  'main deck': 'main',
  sideboard: 'side',
  side: 'side',
  companion: 'companion',
  maybe: 'maybe',
  maybeboard: 'maybe',
  considering: 'maybe',
  about: null,
}

/** Card-type group headings, like "Creatures (30)". They end a Commander or Companion section, nothing else. */
const TYPE_GROUPS: ReadonlySet<string> = new Set([
  'creature', 'creatures', 'land', 'lands', 'instant', 'instants', 'sorcery', 'sorceries', 'artifact', 'artifacts',
  'enchantment', 'enchantments', 'planeswalker', 'planeswalkers', 'battle', 'battles', 'spell', 'spells', 'other',
])

/** Longest line that can be a heading. Headings are a few words; longer lines skip the check. */
const MAX_HEADING_LENGTH = 40

/**
 * A line's heading words, lowercase, without a count and a colon in either order: "Deck", "Deck (60):", "Deck: (60)",
 * "Sideboard: 15". Simple end-anchored steps on a short line, so this stays cheap on any input ('' for long lines).
 */
function headingOf(line: string): string {
  if (line.length > MAX_HEADING_LENGTH) return ''
  return line
    .replace(/:$/, '')
    .trimEnd()
    .replace(/(?:\(\d+\)|\d+)$/, '')
    .trimEnd()
    .replace(/:$/, '')
    .trimEnd()
    .toLowerCase()
}

/** Longest line read as a card. The longest card name is 141 characters; longer lines are reported as skipped. */
const MAX_LINE_LENGTH = 300

/** Most copies one line may name, the same cap the import applies; a line asking for more is reported as skipped. */
const MAX_QUANTITY = 999

// "4 Lightning Bolt", "4x Lightning Bolt", "1 Sol Ring (CMR) 472 *F*", "Lightning Bolt". A set code has a letter.
// The name ends on a non-space, so a run of spaces is tried once rather than from every position inside it.
const CARD_LINE =
  /^(?:(\d+)\s*[xX]?\s+)?(.*?\S)(?:\s+\(((?!\d+\))[A-Za-z0-9]{2,6})\)(?:\s+(\S+))?)?(?:\s+\*[A-Za-z]+\*)*$/s

/**
 * Parses a pasted decklist in Arena, MTGO, or Moxfield text form (spec §5.4.2):
 * - Arena: `4 Lightning Bolt (M11) 149`, with Commander / Deck / Sideboard headings.
 * - MTGO: `4 Lightning Bolt`, sideboard lines as `SB: 2 Duress` or, in a list with no headings, after the first blank
 *   line.
 * - Moxfield: quantity and name, an optional `(SET) number`, and `*F*`-style markers, which are ignored.
 *
 * Headings also accept Maybeboard and Companion, with a count and a colon in either order ("Deck (60):", "Sideboard:
 * 15"). A companion goes to the sideboard unless the sideboard already lists it (Arena's export lists it in both).
 * Card-type group headings ("Creatures (30)") keep the current board. A blank line or a type group ends a Commander or
 * Companion section, returning to the main deck. Lines starting `//` or `#` are comments. Lines over 300 characters
 * can't be a card and are reported as skipped without being read, and so is a line with a quantity over 999.
 */
export function parseDecklist(text: string): ParsedDecklist {
  const entries: DecklistEntry[] = []
  const skipped: ParsedDecklist['skipped'] = []
  const companions = new Set<DecklistEntry>()
  let section: Section = 'main'
  let sawHeading = false
  let blankSwitched = false
  let sawMain = false
  text.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const line = index + 1
    const trimmed = raw.trim()
    const inCommanderOrCompanion = section === 'commander' || section === 'companion'
    if (trimmed === '') {
      if (inCommanderOrCompanion) section = 'main'
      // MTGO: without headings, the first blank line after main-deck cards starts the sideboard.
      else if (!sawHeading && !blankSwitched && sawMain) {
        section = 'side'
        blankSwitched = true
      }
      return
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('#')) return
    if (trimmed.length > MAX_LINE_LENGTH) {
      skipped.push({ line, text: trimmed })
      return
    }
    const heading = headingOf(trimmed)
    // Own keys only: a line like "constructor" must not find Object's members.
    if (Object.hasOwn(SECTIONS, heading)) {
      section = SECTIONS[heading] ?? null
      sawHeading = true
      return
    }
    if (TYPE_GROUPS.has(heading)) {
      if (inCommanderOrCompanion) section = 'main'
      sawHeading = true
      return
    }
    if (section === null) return // inside a skipped section (Arena's "About")
    let lineBoard: Board = section === 'companion' ? 'side' : section
    let body = trimmed
    const sb = /^SB:\s*(.*)$/is.exec(body)
    if (sb) {
      lineBoard = 'side'
      body = sb[1] ?? ''
    }
    const m = CARD_LINE.exec(body)
    const quantity = m?.[1] === undefined ? 1 : Number(m[1])
    const name = m?.[2]?.trim() ?? ''
    // A bare printing like "(CMR) 472" is a broken line, not a card.
    if (!m || name === '' || name.startsWith('(') || quantity < 1 || quantity > MAX_QUANTITY) {
      skipped.push({ line, text: trimmed })
      return
    }
    const entry: DecklistEntry = {
      line,
      quantity,
      name,
      setCode: m[3]?.toLowerCase() ?? null,
      collectorNumber: m[4] ?? null,
      board: lineBoard,
    }
    entries.push(entry)
    if (lineBoard === 'main') sawMain = true
    if (section === 'companion' && !sb) companions.add(entry)
  })
  // Each companion joins the sideboard only if the sideboard doesn't already list it; it keeps its place and line.
  const side = new Set(entries.filter((e) => e.board === 'side' && !companions.has(e)).map((e) => e.name.toLowerCase()))
  const kept = entries.filter((e) => {
    if (!companions.has(e)) return true
    const key = e.name.toLowerCase()
    if (side.has(key)) return false
    side.add(key)
    return true
  })
  return { entries: kept, skipped }
}

/** A deck line to export. */
export interface ExportLine {
  quantity: number
  name: string
  board: Board
  setCode: string | null
  collectorNumber: string | null
}

const ARENA_SECTIONS: Array<[Board, string]> = [
  ['commander', 'Commander'],
  ['main', 'Deck'],
  ['side', 'Sideboard'],
]

/** Arena text: Commander / Deck / Sideboard sections of `4 Name (SET) 123`. The maybe board isn't exported. */
export function toArena(lines: readonly ExportLine[]): string {
  const sections = ARENA_SECTIONS.flatMap(([board, heading]) => {
    const inBoard = lines.filter((l) => l.board === board)
    if (inBoard.length === 0) return []
    const body = inBoard.map((l) =>
      l.setCode && l.collectorNumber
        ? `${l.quantity} ${l.name} (${l.setCode.toUpperCase()}) ${l.collectorNumber}`
        : `${l.quantity} ${l.name}`,
    )
    return [[heading, ...body].join('\n')]
  })
  return sections.length === 0 ? '' : `${sections.join('\n\n')}\n`
}

/**
 * MTGO text: main-deck lines, a blank line, then the sideboard (commanders go there too, as MTGO expects). With no
 * main deck, sideboard lines carry an `SB:` prefix so they still read as sideboard. The maybe board isn't exported.
 */
export function toMtgo(lines: readonly ExportLine[]): string {
  const row = (l: ExportLine) => `${l.quantity} ${l.name}`
  const main = lines.filter((l) => l.board === 'main').map(row)
  const side = lines.filter((l) => l.board === 'side' || l.board === 'commander').map(row)
  if (main.length === 0) return side.length === 0 ? '' : `${side.map((l) => `SB: ${l}`).join('\n')}\n`
  return side.length === 0 ? `${main.join('\n')}\n` : `${main.join('\n')}\n\n${side.join('\n')}\n`
}
