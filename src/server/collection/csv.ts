/** A CSV file that can't be read as a table (or has no column naming the card). */
export class CsvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CsvError'
  }
}

export interface CsvRecord {
  /** Line where the record starts, from 1. */
  line: number
  cells: string[]
}

/** Comma, unless the first line has none and uses tabs or semicolons instead (some spreadsheet exports). */
function detectDelimiter(text: string): string {
  const first = text.slice(0, text.search(/\r|\n|$/))
  if (first.includes(',')) return ','
  if (first.includes('\t')) return '\t'
  if (first.includes(';')) return ';'
  return ','
}

/**
 * Excel's delimiter hint, a first line like `sep=,` or `"sep=;"` (Dragon Shield exports start with one). A spreadsheet
 * that saved the file again may pad it with spaces or empty cells: `"sep=,",,,`.
 */
const SEP_LINE = /^"?sep=(.)"?[ \t,;]*(?:\r\n|\r|\n|$)/i

/**
 * Parses CSV text (RFC 4180: quoted cells may hold delimiters, doubled quotes, and line breaks). Accepts CRLF, LF, or
 * CR line endings and a leading byte-order mark. A leading `sep=` line sets the delimiter and is skipped (later records
 * keep their file line numbers). A cell may have spaces before its opening quote (`1, "Atraxa, Praetors' Voice"`); a
 * quote anywhere else in a cell is kept as text. Throws CsvError when a quoted cell never closes.
 */
export function parseCsv(text: string): CsvRecord[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const sep = SEP_LINE.exec(src)
  const delimiter = sep ? sep[1]! : detectDelimiter(src)
  const records: CsvRecord[] = []
  let cells: string[] = []
  let cell = ''
  // Whether the cell so far is only spaces, so a quote opens a quoted value. Kept as a flag: trimming the cell at each
  // stray quote would copy it every time.
  let blank = true
  let quoted = false
  let quoteLine = 0
  let line = sep ? 2 : 1
  let recordLine = line
  for (let i = sep ? sep[0].length : 0; i < src.length; i++) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"'
        blank = false
        i++
      } else if (ch === '"') {
        quoted = false
      } else {
        // A line break inside the cell: LF, CRLF (counted at its LF), or a CR alone.
        if (ch === '\n' || (ch === '\r' && src[i + 1] !== '\n')) line++
        cell += ch
        blank &&= ch.trim() === ''
      }
    } else if (ch === '"' && blank) {
      quoted = true
      quoteLine = line
      cell = ''
    } else if (ch === delimiter) {
      cells.push(cell)
      cell = ''
      blank = true
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      cells.push(cell)
      records.push({ line: recordLine, cells })
      cells = []
      cell = ''
      blank = true
      line++
      recordLine = line
    } else {
      cell += ch
      blank &&= ch.trim() === ''
    }
  }
  if (quoted) throw new CsvError(`A quoted value starting on line ${quoteLine} never ends (missing closing ")`)
  if (cell !== '' || cells.length > 0) {
    cells.push(cell)
    records.push({ line: recordLine, cells })
  }
  return records
}

/**
 * One CSV line (no line break): cells with a comma, quote, line break, or edge space are quoted. So are cells starting
 * like a formula (with =, +, -, or @, like the card "+2 Mace"): quoting keeps such a name one cell, as it is, for other
 * apps' importers, and marks it as text for spreadsheets that honor quotes. Excel doesn't: it still reads a quoted
 * "=…" as a formula.
 */
export function csvLine(cells: readonly (string | number)[]): string {
  return cells
    .map((value) => {
      const text = String(value)
      const formulaLike = typeof value === 'string' && /^[=+\-@]/.test(text)
      return /[",\r\n]|^\s|\s$/.test(text) || formulaLike ? `"${text.replace(/"/g, '""')}"` : text
    })
    .join(',')
}
