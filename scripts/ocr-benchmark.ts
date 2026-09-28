// `pnpm ocr:bench` (spec §5.1.6): downloads Scryfall's large images of about 70 cards across frame eras and layouts,
// reads each with the OCR helper and the matcher, and prints how each era fared. Use it to tune the matcher's
// thresholds (src/server/scanner/matcher.ts). Images are kept in <data>/bench, so later runs don't download again.
// Scryfall's image of a printing that comes in nonfoil shows the nonfoil card, so only a foil-only printing (whose
// collector line prints the foil ★) should read as foil; each card read as foil is listed with its finishes.
import fs from 'node:fs'
import path from 'node:path'
import { BACKUP_DIR, BENCH_DIR, DB_PATH, OCR_BINARY, OCR_SOURCE } from '../src/server/config.ts'
import { ensureCardNamesCurrent } from '../src/server/cards/repo.ts'
import { openLibrary } from '../src/server/db/index.ts'
import { createCardLookups } from '../src/server/scanner/lookups.ts'
import { COLLECTOR_BAND, decide, readCard } from '../src/server/scanner/matcher.ts'
import { buildOcrHelper, createOcrClient, type OcrResult } from '../src/server/scanner/ocr-client.ts'

const BENCH: ReadonlyArray<[era: string, set: string, number: string]> = [
  ['1993 frame', 'lea', '57'], ['1993 frame', 'lea', '156'], ['1993 frame', '4ed', '72'], ['1993 frame', '4ed', '199'],
  ['1993 frame', 'ice', '72'], ['1993 frame', 'ice', '199'],
  ['1997 frame', 'tmp', '66'], ['1997 frame', 'tmp', '181'], ['1997 frame', 'usg', '66'], ['1997 frame', 'usg', '181'],
  ['1997 frame', 'mmq', '66'], ['1997 frame', 'mmq', '181'], ['1997 frame', '7ed', '66'], ['1997 frame', '7ed', '181'],
  ['2003 frame', '8ed', '66'], ['2003 frame', '8ed', '181'], ['2003 frame', 'rav', '57'], ['2003 frame', 'rav', '157'],
  ['2003 frame', 'm10', '45'], ['2003 frame', 'm10', '125'], ['2003 frame', 'isd', '49'], ['2003 frame', 'isd', '136'],
  ['2015 frame', 'm15', '52'], ['2015 frame', 'm15', '145'], ['2015 frame', 'ktk', '49'], ['2015 frame', 'ktk', '136'],
  ['2015 frame', 'dom', '52'], ['2015 frame', 'dom', '143'], ['2015 frame', 'grn', '53'], ['2015 frame', 'grn', '147'],
  ['2015 frame', 'eld', '75'], ['2015 frame', 'eld', '207'],
  ['2020+', 'znr', '74'], ['2020+', 'znr', '204'], ['2020+', 'khm', '78'], ['2020+', 'khm', '215'],
  ['2020+', 'neo', '98'], ['2020+', 'neo', '269'], ['2020+', 'dmu', '82'], ['2020+', 'dmu', '227'],
  ['2020+', 'one', '89'], ['2020+', 'one', '245'], ['2020+', 'woe', '73'], ['2020+', 'woe', '201'],
  ['2020+', 'mkm', '83'], ['2020+', 'mkm', '229'], ['2020+', 'blb', '73'], ['2020+', 'blb', '201'],
  ['2020+', 'dsk', '80'], ['2020+', 'dsk', '221'], ['2020+', 'fdn', '150'], ['2020+', 'fdn', '433'],
  ['2020+', 'tdm', '81'], ['2020+', 'tdm', '223'],
  ['Showcase/borderless', 'neo', '310'], ['Showcase/borderless', 'neo', '430'], ['Showcase/borderless', 'dmu', '300'],
  ['Showcase/borderless', 'one', '300'], ['Showcase/borderless', 'one', '380'], ['Showcase/borderless', 'woe', '300'],
  ['Showcase/borderless', 'mkm', '300'], ['Showcase/borderless', 'blb', '300'], ['Showcase/borderless', 'dsk', '300'],
  ['Showcase/borderless', 'tdm', '300'], ['Showcase/borderless', 'mh2', '300'], ['Showcase/borderless', 'tdm', '380'],
  ['Split/DFC/adventure', 'isd', '114'], ['Split/DFC/adventure', 'grn', '221'], ['Split/DFC/adventure', 'eld', '102'],
  ['Split/DFC/adventure', 'znr', '106'],
]

type Outcome = 'right' | 'wrong printing' | 'wrong card' | 'printing?' | 'printing? wrong card' | 'unsure' | 'error'
const OUTCOMES: Outcome[] = ['right', 'wrong printing', 'wrong card', 'printing?', 'printing? wrong card', 'unsure', 'error']

// It opens the owner's library (unless BINDER_DATA_DIR says otherwise), so it backs it up before upgrading it too.
const db = openLibrary(DB_PATH, BACKUP_DIR)
ensureCardNamesCurrent(db)
fs.mkdirSync(BENCH_DIR, { recursive: true })
const lookups = createCardLookups(db)
const ocr = createOcrClient({ command: [OCR_BINARY], prepare: async () => void (await buildOcrHelper(OCR_SOURCE, OCR_BINARY)) })

/** The raw text of the lines in the collector band (the bottom of the card's text), as readCard measures it. */
function collectorLines(result: OcrResult): string[] {
  const lines = result.lines.filter((l) => l.text.trim() !== '')
  const top = Math.min(...lines.map((l) => l.box.y))
  const height = Math.max(...lines.map((l) => l.box.y + l.box.h)) - top
  return lines.filter((l) => (l.box.y + l.box.h / 2 - top) / height >= COLLECTOR_BAND).map((l) => l.text)
}

const results: Array<{ era: string; key: string; outcome: Outcome; detail: string; ms: number }> = []
/** Cards whose reading says foil, with the finishes their printing comes in and their raw collector lines. */
const foils: Array<{ key: string; name: string; finishes: string; lines: string[] }> = []
for (const [era, set, number] of BENCH) {
  const key = `${set}-${number}`
  const card = db
    .prepare('SELECT id, oracle_id, name, image_normal, finishes FROM cards WHERE set_code = ? AND collector_number = ?')
    .get(set, number) as { id: string; oracle_id: string; name: string; image_normal: string | null; finishes: string } | undefined
  if (!card?.image_normal) {
    console.log(`skipped ${key}: not in the card data`)
    continue
  }
  const file = path.join(BENCH_DIR, `${key}.jpg`)
  if (!fs.existsSync(file)) {
    const res = await fetch(card.image_normal.replace('/normal/', '/large/'), { headers: { 'User-Agent': 'Binder/0.1 (personal)' } })
    if (!res.ok) throw new Error(`Downloading ${key} failed: HTTP ${res.status}`)
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    await new Promise((r) => setTimeout(r, 100)) // Scryfall asks for at least 50–100 ms between requests
  }
  const started = performance.now()
  try {
    const ocrResult = await ocr.recognize(file)
    const decision = decide(readCard(ocrResult), lookups)
    const ms = performance.now() - started
    const { outcome: o, card: found, reading } = decision
    const sameCard = found?.oracleId === card.oracle_id
    const outcome: Outcome =
      o === 'confident' ? (found?.id === card.id ? 'right' : sameCard ? 'wrong printing' : 'wrong card')
      : o === 'printing' ? (sameCard ? 'printing?' : 'printing? wrong card')
      : 'unsure'
    const read = `title ${JSON.stringify(reading.title)}, set ${reading.setCode ?? '-'}, number ${reading.collectorNumber ?? '-'}, year ${reading.year ?? '-'}${reading.foil ? ', ★' : ''}`
    if (reading.foil) foils.push({ key, name: card.name, finishes: card.finishes, lines: collectorLines(ocrResult) })
    results.push({ era, key, outcome, ms, detail: `${card.name}: ${read} → ${found ? `${found.name} (${found.setCode} ${found.collectorNumber})` : 'nothing'} ${decision.confidence ?? ''}` })
  } catch (err) {
    results.push({ era, key, outcome: 'error', ms: performance.now() - started, detail: `${card.name}: ${(err as Error).message}` })
  }
}
ocr.close()

const eras = [...new Set(results.map((r) => r.era))]
const pad = (s: string | number, n: number) => String(s).padStart(n)
console.log(`\n${'era'.padEnd(22)}${pad('cards', 6)}${OUTCOMES.map((o) => pad(o, o.length + 2)).join('')}`)
for (const era of [...eras, 'all']) {
  const rows = results.filter((r) => era === 'all' || r.era === era)
  const counts = OUTCOMES.map((o) => pad(rows.filter((r) => r.outcome === o).length, o.length + 2))
  console.log(`${era.padEnd(22)}${pad(rows.length, 6)}${counts.join('')}`)
}
const ms = results.map((r) => r.ms).sort((a, b) => a - b)
console.log(`\nOCR + match: median ${ms[Math.floor(ms.length / 2)]!.toFixed(0)} ms, slowest ${ms.at(-1)!.toFixed(0)} ms`)
console.log(`\nRead as foil: ${foils.length === 0 ? 'none' : foils.map((f) => f.key).join(', ')}`)
for (const f of foils) {
  console.log(`  ${f.key} ${f.name} (finishes ${f.finishes}): ${f.lines.map((l) => JSON.stringify(l)).join(' | ')}`)
}
console.log('\nNot identified outright:')
for (const r of results.filter((r) => r.outcome !== 'right')) console.log(`  [${r.outcome}] ${r.key} ${r.detail}`)
db.close()
