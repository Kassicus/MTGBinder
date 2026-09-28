// Seeds a throwaway database with the 61 test fixture cards so the UI can be exercised without a real import.
// Usage: BINDER_DATA_DIR=/tmp/binder-dev node scripts/seed-dev.ts
import fs from 'node:fs'
import { CARD_DATA_VERSION, scryfallToRow, type CardRow } from '../src/server/cards/map.ts'
import { insertCardRows, rebuildCardNames } from '../src/server/cards/repo.ts'
import { DB_PATH } from '../src/server/config.ts'
import { openDb } from '../src/server/db/index.ts'
import { setMeta } from '../src/server/db/meta.ts'
import type { ScryfallCard } from '../src/server/scryfall/types.ts'

if (!process.env.BINDER_DATA_DIR) {
  console.error('Set BINDER_DATA_DIR to a scratch directory so this never touches your real library.')
  process.exit(1)
}
const db = openDb(DB_PATH)
const cards = JSON.parse(fs.readFileSync(new URL('../tests/fixtures/cards.json', import.meta.url), 'utf8')) as ScryfallCard[]
insertCardRows(db, 'cards', cards.map((c) => scryfallToRow(c)).filter((r): r is CardRow => r !== null))
rebuildCardNames(db)
setMeta(db, 'bulk_updated_at', new Date().toISOString())
setMeta(db, 'card_data_version', String(CARD_DATA_VERSION))
console.log(`Seeded ${cards.length} fixture cards into ${DB_PATH}`)
db.close()
