import { normalizeName } from '../../shared/normalize.ts'
import { jaroWinkler } from '../../shared/similarity.ts'
import type { OcrLine, OcrResult } from './ocr-client.ts'

/**
 * Where the title bar sits: lines whose middle is in the top 12% of the card (spec §5.1.2). Heights are measured
 * over the card's text, from the top of the highest line to the bottom of the lowest, so a card that doesn't fill
 * the photo exactly still reads right.
 */
export const TITLE_BAND = 0.12
/** Where the collector line sits: lines whose middle is in the bottom 20% of the card's text. */
export const COLLECTOR_BAND = 0.8
/** Lines starting right of this are the power/toughness box, never the collector number. */
const PT_BOX_X = 0.7
/** When the title names no card clearly, a set-and-number hit counts if the title is at least this similar to its name. */
export const SET_NUMBER_NAME_SIMILARITY = 0.8
/** A name alone is confident at this similarity… */
export const NAME_SIMILARITY = 0.92
/** …when the next different card scores at least this much lower. */
export const NAME_GAP = 0.05
/** Names scoring below this aren't candidates at all. */
export const CANDIDATE_SIMILARITY = 0.75
/** How many candidates a scan keeps for the review list. */
export const MAX_CANDIDATES = 5

/** What the printed card says, as far as OCR could read it. */
export interface CardReading {
  /** The longest text in the title bar, or null. */
  title: string | null
  /** The set code from the collector line ("M15 • EN" gives "m15"), or null. */
  setCode: string | null
  /**
   * The collector number without leading zeros ("0223" gives "223", "114a/264" gives "114a"): the first of
   * `collectorNumbers`, or null.
   */
  collectorNumber: string | null
  /**
   * Every collector-number candidate in the collector band, without leading zeros: numbers on lines of their own, in
   * line order, then numbers over a set size inside longer lines, without duplicates. A stray number (a loyalty cost
   * that lost its minus sign) can come before the real one, so the matcher counts them all.
   */
  collectorNumbers: string[]
  /** The last year in the copyright line ("© 1993-2009" gives 2009), or null. */
  year: number | null
  /**
   * A ★ in place of the • on the collector line, which marks a foil printing. On-device OCR reads the ★ as `*`, so
   * either counts; `•` and `·` don't.
   */
  foil: boolean
  /**
   * Every line's text. A set-and-number hit whose name is a line of its own counts even without a title (split cards
   * print their names sideways, and showcase cards print the real name under a flavor name).
   */
  texts: string[]
}

const middle = (box: { y: number; h: number }) => box.y + box.h / 2
const letters = (text: string) => (text.match(/\p{L}/gu) ?? []).length

/**
 * "M15 • EN", "TDM ★ EN": a set code, a bullet (a star on foils), and a language code. On-device OCR reads the foil
 * star as `*` ("TDM * EN"), and some fonts' bullet as `·`.
 */
const SET_LINE = /(?:^|[^A-Z0-9])([A-Z0-9]{3,5})\s*([•★*·])\s*([A-Z]{2,3})\b/
/** The marks on the collector line that mean foil: the ★, and the `*` OCR reads it as. */
const FOIL_MARKS = new Set(['★', '*'])
/** A line holding only a collector number: "145/269 R", "M 0223", "221/259", "0012". */
const NUMBER_LINE = /^(?:[CURMSLTBP]\s+)?0*(\d{1,4}[a-z]?)(?:\s*\/\s*\d{1,4})?(?:\s+[CURMSLTBP])?$/
/** A number over a set size inside a longer line, as 2003–2014 cards print it: "…Wizards of the Coast 66/350". */
const NUMBER_OF_TOTAL = /(?:^|\D)0*(\d{1,4}[a-z]?)\s*\/\s*(\d{2,4})(?!\d)/
/** A copyright line: "© 1995 Wizards…", "TM & © 1993-2009 Wizards…", "™ & © 2025 Wizards…". */
const COPYRIGHT = /wizards|©|™/i
const YEAR = /(?<!\d)(199\d|20[0-4]\d)(?!\d)/g

/** True when OCR read some words. A capture without any is the bare scanning area, not a card. */
export function hasText(ocr: OcrResult): boolean {
  return ocr.lines.some((line) => letters(line.text) >= 3)
}

/**
 * Reads the title, set code, collector number, copyright year, and foil star from OCR lines (spec §5.1.2). The foil
 * star is a ★, or the `*` on-device OCR reads it as, in place of the •.
 */
export function readCard(ocr: OcrResult): CardReading {
  const lines = ocr.lines.filter((l) => l.text.trim() !== '')
  const top = Math.min(...lines.map((l) => l.box.y))
  const height = Math.max(...lines.map((l) => l.box.y + l.box.h)) - top
  const at = (box: OcrLine['box']) => (lines.length < 2 || height <= 0 ? middle(box) : (middle(box) - top) / height)
  let title: string | null = null
  for (const line of lines) {
    if (at(line.box) > TITLE_BAND || letters(line.text) < 3) continue
    if (title === null || letters(line.text) > letters(title)) title = line.text.trim()
  }
  let setCode: string | null = null
  let foil = false
  const numberLines: string[] = []
  const numbersOfTotal: string[] = []
  let year: number | null = null
  const bottom = lines.filter((l) => at(l.box) >= COLLECTOR_BAND).sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)
  for (const line of bottom) {
    const text = line.text.trim()
    const set = SET_LINE.exec(text)
    if (set && setCode === null && /[A-Z]/.test(set[1]!)) {
      setCode = set[1]!.toLowerCase()
      foil = FOIL_MARKS.has(set[2]!)
    }
    if (COPYRIGHT.test(text)) for (const [y] of text.matchAll(YEAR)) year = Math.max(year ?? 0, Number(y))
    if (line.box.x > PT_BOX_X) continue
    const number = NUMBER_LINE.exec(text)
    if (number) numberLines.push(number[1]!)
    // A set holds at least 20 cards, and the number is at most the set size, unlike power/toughness ("3/3").
    const ofTotal = NUMBER_OF_TOTAL.exec(text)
    const total = Number(ofTotal?.[2])
    if (ofTotal && parseInt(ofTotal[1]!, 10) <= total && total >= 20) numbersOfTotal.push(ofTotal[1]!)
  }
  const collectorNumbers = [...new Set([...numberLines, ...numbersOfTotal])]
  const texts = lines.map((l) => l.text)
  return { title, setCode, collectorNumber: collectorNumbers[0] ?? null, collectorNumbers, year, foil, texts }
}

/** A printing, as the matcher sees it. */
export interface CardRef {
  id: string
  oracleId: string
  name: string
  faceNames: string[]
  setCode: string
  collectorNumber: string
  releasedAt: string
  lang: string
}

/** The card data the matcher needs; the server answers from SQLite, tests from a list. */
export interface CardLookups {
  /** Printings with this set code and collector number. */
  bySetAndNumber(setCode: string, collectorNumber: string): CardRef[]
  /** Every set code in the card data. */
  setCodes(): readonly string[]
  /** The card identity a name means exactly (its full name or a face's, ignoring case and punctuation), or null. */
  findName(name: string): string | null
  /** Card identities whose name (or a face's) scores at least `threshold` against a normalized name, best first. */
  searchNames(normalized: string, threshold: number): Array<{ oracleId: string; score: number }>
  /** Every printing of a card identity, the default printing first. */
  printings(oracleId: string): CardRef[]
  /**
   * The other card identities with exactly this one's full name, ignoring letter case (Unstable's Everythingamajig
   * variants are six cards with one name), or none. `findName` and `searchNames` give only one of them.
   */
  namesakes(oracleId: string): string[]
}

export interface ScoredCard {
  card: CardRef
  score: number
}

/**
 * What a scan found:
 * - `confident`: the card and its printing.
 * - `printing`: the card is certain but its printing isn't; `card` is the likeliest printing.
 * - `unsure`: not certain which card this is; `candidates` lists the likeliest, best first.
 */
export interface MatchDecision {
  outcome: 'confident' | 'printing' | 'unsure'
  card: CardRef | null
  confidence: number | null
  candidates: ScoredCard[]
  reading: CardReading
  /**
   * True when the set code, a collector number, or the copyright year read ruled out every printing of the card the
   * title named that was still left after the filters before it (step 3): the only sign that the title itself may be
   * misread. False on every other path.
   */
  contradicted: boolean
}

/** Best similarity between a normalized title and a printing's names (full and each face); 0 without a title. */
function titleSimilarity(card: CardRef, title: string): number {
  if (title === '') return 0
  let best = 0
  for (const name of [card.name, ...card.faceNames].map(normalizeName)) {
    if (name !== '') best = Math.max(best, jaroWinkler(title, name))
  }
  return best
}

/**
 * True when a printing's name is a line of its own on the card: its whole name, or at least two of its face names
 * (a split card's sideways halves). Exact text only, so a keyword line ("Flying") can't vouch for a card whose name
 * is merely close ("Fling").
 */
function namePrinted(card: CardRef, texts: readonly string[]): boolean {
  const lines = new Set(texts.map(normalizeName).filter((t) => t !== ''))
  if (lines.has(normalizeName(card.name))) return true
  if (card.faceNames.length < 2) return false
  const faces = new Set(card.faceNames.map(normalizeName))
  return [...faces].filter((face) => lines.has(face)).length >= 2
}

const withoutSuffix = (number: string) => number.replace(/[a-z]$/, '')

/** Same length, one character different. */
function oneApart(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let differences = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differences++
  return differences === 1
}
const round = (score: number) => Math.round(score * 1000) / 1000

/** Each card identity's default printing with its score, best first, each identity once, at most MAX_CANDIDATES. */
function topCandidates(ranked: ReadonlyArray<{ oracleId: string; score: number }>, lookups: CardLookups): ScoredCard[] {
  const seen = new Set<string>()
  const candidates: ScoredCard[] = []
  for (const { oracleId, score } of ranked) {
    if (candidates.length === MAX_CANDIDATES) break
    if (seen.has(oracleId)) continue
    seen.add(oracleId)
    const card = lookups.printings(oracleId)[0]
    if (card) candidates.push({ card, score: round(score) })
  }
  return candidates
}

/**
 * Decides which card a reading is (spec §5.1.2, as the plan amends it). It is never confident on a guess:
 * 1. The set code and a collector number read name exactly one printing that the card vouches for. When the title
 *    names a card, only that card (or a namesake) vouches; otherwise the title must be close to the printing's name
 *    (SET_NUMBER_NAME_SIMILARITY), or its name must be a line of its own.
 * 2. Otherwise the title must name one card, exactly or clearly more closely than any other, and no other card may
 *    share that name.
 * 3. Then the set code, collector numbers, and copyright year read narrow that card's English printings. One left,
 *    with nothing read contradicting it, is the printing.
 */
export function decide(reading: CardReading, lookups: CardLookups): MatchDecision {
  const { title, setCode, year } = reading
  const numbers = [...new Set([reading.collectorNumber, ...reading.collectorNumbers].filter((n) => n !== null))]
  // A printing's number is a candidate read, or one without its letter ("114a" read for a card numbered 114).
  const numberKeys = [...new Set(numbers.flatMap((n) => [n, withoutSuffix(n)]))]

  // What the title identifies: the card it names exactly, or the one it names clearly more closely than any other,
  // plus that card's namesakes; null when it names no card clearly.
  const key = title ? normalizeName(title) : ''
  const ranked = key === '' ? [] : lookups.searchNames(key, CANDIDATE_SIMILARITY)
  const exact = title ? lookups.findName(title) : null
  if (exact) ranked.unshift({ oracleId: exact, score: 1 })
  let candidates = topCandidates(ranked, lookups)
  const [best, next] = candidates
  const clearlyBest = best !== undefined && best.score >= NAME_SIMILARITY && (!next || best.score - next.score >= NAME_GAP)
  const named = best && (best.card.oracleId === exact || clearlyBest) ? best : null
  const namesakes = named ? lookups.namesakes(named.card.oracleId) : []
  const identified = named ? [named.card.oracleId, ...namesakes] : null

  // 1. The set code and a collector number read name one printing, and the card vouches for it. Every candidate number
  // is tried. A set code that names no printing at any of them may be misread by one character (TDM read as TOM), so
  // set codes one character away are tried too; the name check keeps that safe. A set code that names a different
  // card isn't retried: the set or the number is wrong, and there's no telling which.
  if (setCode && numberKeys.length > 0) {
    const find = (codes: readonly string[]) =>
      codes.flatMap((code) => numberKeys.flatMap((n) => lookups.bySetAndNumber(code, n)))
    let hits = find([setCode])
    if (hits.length === 0) hits = find(lookups.setCodes().filter((code) => oneApart(code, setCode)))
    const texts = title ? [title, ...reading.texts] : reading.texts
    const accepted = hits
      .map((card) => ({ card, similarity: round(titleSimilarity(card, key)), printed: namePrinted(card, texts) }))
      .filter(({ card, similarity, printed }) =>
        identified ? identified.includes(card.oracleId) : similarity >= SET_NUMBER_NAME_SIMILARITY || printed,
      )
    // Two different printings vouched for leave it to the title.
    if (accepted.length > 0 && accepted.every((a) => a.card.id === accepted[0]!.card.id)) {
      const { card, similarity, printed } = accepted[0]!
      const hit = { card, score: printed ? 1 : similarity }
      return { outcome: 'confident', card, confidence: hit.score, candidates: [hit], reading, contradicted: false }
    }
  }

  // 2. The title names one card: exactly, or clearly more closely than any other card. When other cards share its name
  // (namesakes), it's unsure which one this is; they lead the candidates.
  if (named && namesakes.length > 0) {
    const same = [named.card.oracleId, ...namesakes].map((oracleId) => ({ oracleId, score: named.score }))
    candidates = topCandidates([...same, ...ranked], lookups)
  }
  if (!named || namesakes.length > 0) {
    const [first] = candidates
    const card = first?.card ?? null
    return { outcome: 'unsure', card, confidence: first?.score ?? null, candidates, reading, contradicted: false }
  }

  // 3. Which printing. An English title means an English card, so only English printings count; a card with none
  // can't be confident of its printing. The set code, collector numbers, and copyright year read each narrow them. A
  // filter that would leave none contradicts what was read: the printings stay as they were, and the printing is
  // unsure. One printing left, with nothing contradicted, is the printing.
  const printings = lookups.printings(named.card.oracleId)
  const english = printings.filter((p) => p.lang === 'en')
  let pool = english.length > 0 ? english : printings
  const filters: Array<(p: CardRef) => boolean> = []
  if (setCode) filters.push((p) => p.setCode === setCode)
  if (numberKeys.length > 0) filters.push((p) => numberKeys.includes(p.collectorNumber))
  if (year) filters.push((p) => [year, year + 1].includes(Number(p.releasedAt.slice(0, 4))))
  let contradicted = false
  for (const keep of filters) {
    const left = pool.filter(keep)
    if (left.length > 0) pool = left
    else contradicted = true
  }
  const outcome = pool.length === 1 && !contradicted && english.length > 0 ? 'confident' : 'printing'
  return { outcome, card: pool[0]!, confidence: named.score, candidates, reading, contradicted }
}
