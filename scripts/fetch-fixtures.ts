// Fetches the pinned fixture printings from Scryfall into tests/fixtures/cards.json.
// Run once with `pnpm fixtures`. Tests only ever read the saved file.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// [set, collector number]: each pin covers an edge case (DFC, split, adventure, flip, X/hybrid/Phyrexian
// costs, colorless, basics, "any number", partners, planeswalkers, multiple printings of one card).
const FIXTURES: Array<[set: string, collectorNumber: string]> = [
  ['m10', '146'], ['m11', '149'], ['sta', '42'], // Lightning Bolt x3
  ['cmr', '472'], ['c21', '263'], // Sol Ring x2
  ['fdn', '227'], ['fdn', '740'], ['fra', '116'], ['inr', '60'], ['soc', '190'],
  ['dmr', '215'], ['chk', '2'], ['znr', '90'], ['clb', '175'], ['uma', '216'],
  ['nph', '35'], ['m21', '272'], ['m21', '263'], ['m21', '260'], ['m21', '266'],
  ['m21', '269'], ['frc', '22'], ['a25', '105'], ['c16', '46'], ['c16', '48'],
  ['2xm', '190'], ['2xm', '56'], ['leb', '233'], ['dsc', '114'], ['cmm', '70'],
  ['msc', '170'], ['znr', '232'], ['otc', '235'], ['dsc', '273'], ['dmr', '233'],
  ['2x2', '1'], ['fdn', '216'], ['iko', '226'], ['dsc', '220'], ['2xm', '275'],
  ['frc', '20'], ['frc', '37'], ['msc', '793'], ['2xm', '109'], ['m21', '1'],
  ['m21', '176'], ['10e', '268'], ['leb', '48'], ['moc', '343'], ['mkm', '218'],
  ['rvr', '232'], ['msc', '169'], ['msc', '172'], ['j22', '114'], ['cmm', '57'],
  ['trk', '299'], ['mom', '194'], ['cmd', '157'], ['mh2', '12'], ['hoc', '205'],
  ['inr', '287'],
]

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../tests/fixtures/cards.json')
const res = await fetch('https://api.scryfall.com/cards/collection', {
  method: 'POST',
  headers: { 'User-Agent': 'Binder/0.1 (personal)', Accept: 'application/json', 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifiers: FIXTURES.map(([set, collector_number]) => ({ set, collector_number })) }),
})
if (!res.ok) throw new Error(`Scryfall returned ${res.status}: ${await res.text()}`)
const body = (await res.json()) as { data: unknown[]; not_found: unknown[] }
if (body.not_found.length > 0) throw new Error(`Fixtures not found: ${JSON.stringify(body.not_found)}`)
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, `${JSON.stringify(body.data, null, 1)}\n`)
console.log(`Wrote ${body.data.length} cards to ${out}`)
