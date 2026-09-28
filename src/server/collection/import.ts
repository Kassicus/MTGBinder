import { normalizeName } from '../../shared/normalize.ts'
import type { Finish, ImportPreview, ImportRow, ImportRowStatus } from '../../shared/types.ts'
import { createFuzzySearch, type FuzzySearch } from '../cards/fuzzy.ts'
import { cardNameIndex } from '../cards/names.ts'
import { DEFAULT_PRINTING_ORDER } from '../cards/repo.ts'
import type { DB } from '../db/index.ts'
import { CsvError, parseCsv } from './csv.ts'

/** Most copies one CSV row may add. */
export const MAX_ROW_QUANTITY = 9999

/** How close a misspelled name ending in parentheses must be to a card's (as for decklist names, spec §5.4.2). */
const CLOSE_NAME = 0.92

type Column = 'quantity' | 'name' | 'simpleName' | 'scryfallId' | 'setCode' | 'set' | 'setName' | 'number' | 'finish'

/**
 * Accepted headings per column, compared case-insensitively. Covers Moxfield, Deckbox, ManaBox, Archidekt, TCGplayer,
 * and Dragon Shield exports. `set` holds a set code or a set name; `setCode`/`setName` hold only one kind.
 */
const HEADINGS: Record<Column, readonly string[]> = {
  quantity: ['count', 'quantity', 'qty'],
  name: ['name', 'card name', 'card'],
  // TCGplayer's Name adds the variant ("Lightning Bolt (Borderless)"); its Simple Name doesn't.
  simpleName: ['simple name'],
  scryfallId: ['scryfall id', 'scryfall_id'],
  setCode: ['set code', 'edition code'],
  set: ['set', 'edition'],
  setName: ['set name', 'edition name'],
  number: ['collector number', 'card number', 'number', 'collector_number'],
  finish: ['foil', 'finish', 'printing'],
}

/** Finish cell values (lowercase). Blank means nonfoil; any other truthy word means foil. */
const FINISH_WORDS: Record<string, Finish> = {
  '': 'nonfoil', nonfoil: 'nonfoil', 'non-foil': 'nonfoil', normal: 'nonfoil', regular: 'nonfoil', no: 'nonfoil',
  n: 'nonfoil', false: 'nonfoil', '0': 'nonfoil',
  foil: 'foil', yes: 'foil', y: 'foil', true: 'foil', '1': 'foil',
  etched: 'etched', 'etched foil': 'etched', 'foil etched': 'etched',
}

const FINISHES: readonly Finish[] = ['nonfoil', 'foil', 'etched']

interface PrintingRow {
  id: string
  oracle_id: string
  name: string
  face_names: string
  set_code: string
  set_name: string
  collector_number: string
  finishes: string
}

interface Candidate extends PrintingRow {
  finishList: Finish[]
}

const PRINTING_COLUMNS = 'id, oracle_id, name, face_names, set_code, set_name, collector_number, finishes'

function candidate(row: PrintingRow): Candidate {
  return { ...row, finishList: JSON.parse(row.finishes) as Finish[] }
}

/**
 * A name (with no trailing spaces) without its last variant note in parentheses or brackets: "Lightning Bolt
 * (Borderless) [Foil]" gives "Lightning Bolt (Borderless)". Null when it doesn't end in a note; a note holding another
 * bracket of its kind isn't one ("Bolt (a (b))").
 */
function peelNote(name: string): string | null {
  const close = name.at(-1)
  const open = close === ')' ? '(' : close === ']' ? '[' : null
  if (open === null) return null
  const at = name.lastIndexOf(open)
  if (at < 0 || name.slice(at + 1, -1).includes(close!)) return null
  return name.slice(0, at).trimEnd()
}

/**
 * A name without its trailing variant notes in parentheses or brackets, as TCGplayer writes some names: "Lightning
 * Bolt (Borderless)" and "Lightning Bolt (Borderless) [Foil]" give "Lightning Bolt". Null when nothing is left, as for
 * "(Borderless)": a blank name would match the card named "_____".
 */
export function withoutVariant(name: string): string | null {
  let rest = name.trimEnd()
  for (let next = peelNote(rest); next !== null; next = peelNote(rest)) rest = next
  return rest.trim() === '' ? null : rest
}

/** Most variant notes peeled one at a time; no real name stacks this many. */
const MAX_PEELED_NOTES = 8

/**
 * Whether a name is blank once normalized without being the card named "_____" (only underscores), whose own name
 * normalizes to nothing too: "()" would find that card, and "_____" is it.
 */
const blankOtherThanUnderscores = (name: string) => normalizeName(name) === '' && !/^_+$/.test(name.trim())

/**
 * The names a written name could stand for, fullest first: as written, then without its last variant note, then
 * without its last two, and so on to none. A card's own name can end in parentheses, so "Erase (Not the Urza's Legacy
 * One) (Extended Art) [Foil]" gives four names, the third being that card and the fourth another. Stops before a name
 * that would be blank once normalized: "(Borderless)" gives only itself, and "()" would be the card named "_____"
 * (though "_____ [Foil]" gives "_____", that card's own name). Past MAX_PEELED_NOTES notes the rest come off at once,
 * so each name is looked up in time linear in its length.
 */
export function variantStages(name: string): string[] {
  const stages = [name.trimEnd()]
  for (let next = peelNote(stages[0]!); next !== null && !blankOtherThanUnderscores(next); next = peelNote(next)) {
    if (stages.length > MAX_PEELED_NOTES) {
      const bare = withoutVariant(next)
      if (bare !== null && !blankOtherThanUnderscores(bare)) stages.push(bare)
      break
    }
    stages.push(next)
  }
  return stages
}

/** The first thing `find` finds for one of the names, trying them in order. */
function findFirst(names: readonly string[], find: (name: string) => string | null | undefined): string | undefined {
  for (const name of names) {
    const found = find(name)
    if (found) return found
  }
  return undefined
}

/**
 * Maps each column to the indexes of the headings that name it, in file order. When two headings mean the same thing,
 * each row reads the first of their cells that isn't blank (the set columns try each non-blank value in turn).
 */
function findColumns(header: readonly string[]): Partial<Record<Column, number[]>> {
  const found: Partial<Record<Column, number[]>> = {}
  header.forEach((heading, index) => {
    const key = heading.trim().toLowerCase()
    for (const column of Object.keys(HEADINGS) as Column[]) {
      if (HEADINGS[column].includes(key)) (found[column] ??= []).push(index)
    }
  })
  return found
}

/**
 * Resolves each row of a collection CSV to a printing, without changing anything (spec §5.3). A row resolves by
 * Scryfall ID, then set + collector number, then set + name, then name alone (the card's default printing). Rows
 * where the printing had to be picked are `ambiguous`; rows that can't be imported are `unresolved`, with a reason.
 * Throws CsvError when the file can't be read or no column names the card.
 */
export function previewImport(db: DB, text: string): ImportPreview {
  const records = parseCsv(text).filter((r) => r.cells.some((cell) => cell.trim() !== ''))
  const header = records.shift()
  if (!header) throw new CsvError('The file is empty')
  const columns = findColumns(header.cells)
  const namesCard =
    columns.name || columns.simpleName || columns.scryfallId || (columns.number && (columns.set || columns.setCode || columns.setName))
  if (!namesCard) {
    throw new CsvError(
      `No column names the card. The first line must name the columns, like Count,Name,Edition,Collector Number,Foil ` +
        `(found: ${header.cells.map((c) => c.trim()).join(', ')})`,
    )
  }
  const resolver = createResolver(db)
  const rows = records.map((record) => {
    const cell = (column: Column) =>
      (columns[column] ?? []).map((i) => (record.cells[i] ?? '').trim()).find((value) => value !== '') ?? ''
    const setValues = (['setCode', 'set', 'setName'] as const).flatMap((column) =>
      (columns[column] ?? []).map((i) => (record.cells[i] ?? '').trim()).filter((value) => value !== ''),
    )
    const simpleName = cell('simpleName')
    return resolver.resolve({
      line: record.line,
      quantityText: cell('quantity'),
      name: simpleName || cell('name'),
      otherName: simpleName === '' ? '' : cell('name'),
      scryfallId: cell('scryfallId'),
      setValues,
      number: cell('number'),
      finishText: cell('finish'),
    })
  })
  const counts: Record<ImportRowStatus, number> = { resolved: 0, ambiguous: 0, unresolved: 0 }
  for (const row of rows) counts[row.status]++
  return { rows, counts }
}

interface RowInput {
  line: number
  quantityText: string
  name: string
  /** The Name cell of a row whose name came from Simple Name (TCGplayer), or ''. */
  otherName: string
  scryfallId: string
  setValues: string[]
  number: string
  finishText: string
}

function createResolver(db: DB) {
  const setByCode = new Map<string, { code: string; name: string }>()
  const setByName = new Map<string, { code: string; name: string }>()
  for (const s of db.prepare('SELECT set_code AS code, set_name AS name FROM cards GROUP BY set_code').all() as Array<{
    code: string
    name: string
  }>) {
    setByCode.set(s.code.toLowerCase(), s)
    setByName.set(s.name.toLowerCase(), s)
  }
  const names = cardNameIndex(db)
  // The cards whose names end in parentheses ("Erase (Not the Urza's Legacy One)"), searched only when a written name
  // with a note matches no card: a misspelling of one of them would otherwise lose its note and become another card.
  let parenthesized: FuzzySearch | null = null
  const closeParenthesized = (name: string) => {
    parenthesized ??= createFuzzySearch(names.keys.filter(({ oracleId }) => /\)\s*$/.test(names.name(oracleId) ?? '')))
    return parenthesized(normalizeName(name), CLOSE_NAME)[0]?.oracleId ?? null
  }
  const byId = db.prepare(`SELECT ${PRINTING_COLUMNS} FROM cards WHERE id = ?`)
  const bySetNumber = db.prepare(`SELECT ${PRINTING_COLUMNS} FROM cards WHERE set_code = ? AND collector_number = ?`)
  const byOracle = db.prepare(`SELECT ${PRINTING_COLUMNS} FROM cards WHERE oracle_id = ? ORDER BY ${DEFAULT_PRINTING_ORDER}`)
  const printingsCache = new Map<string, Candidate[]>()
  const printingsOf = (oracleId: string): Candidate[] => {
    let list = printingsCache.get(oracleId)
    if (!list) {
      list = (byOracle.all(oracleId) as PrintingRow[]).map(candidate)
      printingsCache.set(oracleId, list)
    }
    return list
  }
  const findSet = (values: readonly string[]) => {
    for (const value of values) {
      const key = value.toLowerCase()
      const set = setByCode.get(key) ?? setByName.get(key)
      if (set) return set
    }
    return null
  }
  const nameIs = (card: Candidate, name: string) => {
    const key = normalizeName(name)
    return normalizeName(card.name) === key || card.face_names.split('\n').some((face) => normalizeName(face) === key)
  }
  const nameMatches = (card: Candidate, name: string) => variantStages(name).some((stage) => nameIs(card, stage))

  function resolve(input: RowInput): ImportRow {
    const finishKey = input.finishText.toLowerCase()
    // Own keys only: a cell like "constructor" must not find Object's members.
    const knownFinish = Object.hasOwn(FINISH_WORDS, finishKey)
    const finish: Finish = knownFinish ? FINISH_WORDS[finishKey]! : 'foil'
    const quantity = input.quantityText === '' ? 1 : /^\d+$/.test(input.quantityText) ? Number(input.quantityText) : NaN
    const base = {
      line: input.line,
      input: { name: input.name, set: input.setValues[0] ?? '', collectorNumber: input.number },
      quantity: Number.isFinite(quantity) ? quantity : 0,
      finish,
    }
    const unresolved = (note: string): ImportRow => ({ ...base, status: 'unresolved', card: null, note })
    if (!Number.isInteger(quantity) || quantity < 1) {
      return unresolved(`The count "${input.quantityText}" isn't a whole number of 1 or more`)
    }
    if (quantity > MAX_ROW_QUANTITY) return unresolved(`The count ${quantity} is more than ${MAX_ROW_QUANTITY}`)

    // What went wrong finding the printing (a set + name row with none is certain). The finish note is kept apart, so
    // it doesn't make the printing doubtful, and is said first on rows that get a card.
    const notes: string[] = []
    const finishNote = knownFinish ? null : `Read "${input.finishText}" as foil`
    const found = (status: 'resolved' | 'ambiguous', card: Candidate): ImportRow => {
      if (finishNote) notes.unshift(finishNote)
      let chosen = finish
      if (!card.finishList.includes(finish)) {
        chosen = FINISHES.find((f) => card.finishList.includes(f)) ?? finish
        notes.push(`This printing has no ${finish} version; adding ${chosen}`)
      }
      return {
        ...base,
        finish: chosen,
        status,
        card: {
          id: card.id,
          name: card.name,
          setCode: card.set_code,
          setName: card.set_name,
          collectorNumber: card.collector_number,
        },
        note: notes.length > 0 ? notes.join('. ') : null,
      }
    }
    /** The first candidate that comes in the row's finish, else the first. */
    const pick = (list: readonly Candidate[]) => list.find((c) => c.finishList.includes(finish)) ?? list[0]!

    if (input.scryfallId !== '') {
      const row = byId.get(input.scryfallId) as PrintingRow | undefined
      if (row) return found('resolved', candidate(row))
      notes.push(`Scryfall ID ${input.scryfallId} isn't in the card data`)
    }
    const set = findSet(input.setValues)
    if (input.setValues.length > 0 && !set) notes.push(`Unknown set "${input.setValues[0]}"`)
    if (set && input.number !== '') {
      const row = (bySetNumber.get(set.code, input.number) ??
        bySetNumber.get(set.code, input.number.replace(/^0+(?=\d)/, ''))) as PrintingRow | undefined
      if (row && (input.name === '' || nameMatches(candidate(row), input.name))) return found('resolved', candidate(row))
      notes.push(
        row ? `${set.name} #${input.number} is ${row.name}, not ${input.name}` : `${set.name} has no #${input.number}`,
      )
    }
    // TCGplayer's Name is its Simple Name, or that with the variant after it; a Name that isn't is worth a look. A
    // Simple Name that normalizes to nothing (the card named "_____") is compared as written, in lowercase.
    const asWritten = normalizeName(input.name) === ''
    const simple = asWritten ? input.name.toLowerCase() : normalizeName(input.name)
    const other = asWritten ? input.otherName.toLowerCase() : normalizeName(input.otherName)
    if (input.otherName !== '' && other !== simple && !other.startsWith(`${simple} `)) {
      notes.push(`Its Name is "${input.otherName}"; went by its Simple Name`)
    }
    // The name as written and each partly peeled name, fullest first (a card's own name may end in parentheses); then
    // a close misspelling of a card whose name ends in parentheses; then the name with no notes.
    const stages = input.name === '' ? [] : variantStages(input.name)
    const noted = stages.slice(0, -1)
    let oracleId = findFirst(noted, (name) => names.find(name)?.oracleId)
    if (!oracleId && noted.length > 0) {
      oracleId = findFirst(noted, closeParenthesized)
      if (oracleId) notes.push(`Read "${input.name}" as ${names.name(oracleId)}`)
    }
    if (!oracleId && stages.length > 0) oracleId = names.find(stages.at(-1)!)?.oracleId
    if (!oracleId) {
      if (input.name === '') return unresolved(notes.length > 0 ? notes.join('. ') : 'The row has no card name')
      return unresolved([...notes, `No card named "${input.name}"`].join('. '))
    }
    const printings = printingsOf(oracleId)
    if (set) {
      const inSet = printings.filter((p) => p.set_code === set.code)
      if (inSet.length === 1 && notes.length === 0) return found('resolved', inSet[0]!)
      if (inSet.length > 0) {
        const chosen = pick(inSet)
        if (inSet.length > 1) notes.push(`${inSet.length} printings in ${set.name}; picked #${chosen.collector_number}`)
        return found('ambiguous', chosen)
      }
      notes.push(`Not printed in ${set.name}`)
    }
    const chosen = pick(printings)
    notes.push(input.setValues.length === 0 ? 'No set given; picked its usual printing' : 'Picked its usual printing')
    return found('ambiguous', chosen)
  }

  return { resolve }
}
