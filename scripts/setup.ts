// `pnpm run setup`: builds the OCR helper, creates the database, and performs the first Scryfall card-data import.
import { createBulkImporter } from '../src/server/bulk/import.ts'
import { ensureCardNamesCurrent } from '../src/server/cards/repo.ts'
import { BACKUP_DIR, DATA_DIR, DB_PATH, OCR_BINARY, OCR_SOURCE } from '../src/server/config.ts'
import { openLibrary } from '../src/server/db/index.ts'
import { buildOcrHelper } from '../src/server/scanner/ocr-client.ts'
import { createScryfallClient } from '../src/server/scryfall/client.ts'

try {
  const built = await buildOcrHelper(OCR_SOURCE, OCR_BINARY)
  console.log(built ? `Built the OCR helper at ${OCR_BINARY}` : 'The OCR helper is up to date.')
} catch (err) {
  // Scanning needs it; everything else works without it, so carry on.
  console.error((err as Error).message)
  process.exitCode = 1
}

const db = openLibrary(DB_PATH, BACKUP_DIR)
console.log(`Database ready at ${DB_PATH}`)
if (ensureCardNamesCurrent(db)) console.log('Rebuilt the card name index for this version.')

const bulk = createBulkImporter({ db, client: createScryfallClient(), dataDir: DATA_DIR })
if (!bulk.isStale()) {
  console.log('Card data is up to date.')
} else {
  console.log('Importing Scryfall card data (downloads about 80 MB when Scryfall has newer data)…')
  const started = Date.now()
  const timer = setInterval(() => {
    const s = bulk.status()
    const progress = s.state === 'downloading' ? 'Downloading from Scryfall…' : `Importing… ${s.processed.toLocaleString()} printings`
    process.stdout.write(`\r  ${progress}   `)
  }, 500)
  await bulk.start()
  clearInterval(timer)
  const status = bulk.status()
  if (status.state === 'error') {
    console.error(`\nCard data import failed: ${status.error}`)
    process.exitCode = 1
  } else {
    console.log(`\nImported ${status.cardCount.toLocaleString()} printings in ${Math.round((Date.now() - started) / 1000)}s.`)
  }
}
db.close()
