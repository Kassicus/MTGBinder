import fs from 'node:fs'
import { serve } from '@hono/node-server'
import { createAiClient } from './ai/client.ts'
import { createKeyStore } from './ai/key-store.ts'
import { createApp } from './app.ts'
import { backupIfDue } from './backup.ts'
import { createBulkImporter } from './bulk/import.ts'
import { ensureCardNamesCurrent } from './cards/repo.ts'
import {
  BACKUP_DIR,
  DATA_DIR,
  DB_PATH,
  ENV_PATH,
  HOST,
  OCR_BINARY,
  OCR_SOURCE,
  PORT,
  SCANS_DIR,
  WEB_DIST_DIR,
} from './config.ts'
import { openLibrary } from './db/index.ts'
import { createCardLookups } from './scanner/lookups.ts'
import { buildOcrHelper, createOcrClient } from './scanner/ocr-client.ts'
import { createScanWorker } from './scanner/worker.ts'
import { createScryfallClient } from './scryfall/client.ts'
import { listenFailure, portProblem } from './startup.ts'

// A PORT that isn't a port number is said in one line, before anything else happens.
const badPort = portProblem(process.env.PORT)
if (badPort) {
  console.error(badPort)
  process.exit(1)
}

// An existing library is copied to backups/ before a migration upgrades it; if that copy fails, Binder says so in one
// line and doesn't start.
const db = openLibrary(DB_PATH, BACKUP_DIR)
if (ensureCardNamesCurrent(db)) console.log('[card data] Rebuilt the card name index for this version')
try {
  const backup = backupIfDue(db, BACKUP_DIR)
  if (backup?.status === 'saved') console.log(`[backup] Saved ${backup.file}`)
  if (backup?.status === 'exists') console.log(`[backup] Today's backup already exists: ${backup.file}`)
} catch (err) {
  // A failed backup must not stop the app; it's retried at the next start.
  console.error(`[backup] Failed: ${err instanceof Error ? err.message : String(err)}`)
}
const scryfall = createScryfallClient()
const bulk = createBulkImporter({
  db,
  client: scryfall,
  dataDir: DATA_DIR,
  log: (message) => console.log(`[card data] ${message}`),
})
const ai = createAiClient(createKeyStore(ENV_PATH))
const ocr = createOcrClient({
  command: [OCR_BINARY],
  prepare: async () => {
    if (await buildOcrHelper(OCR_SOURCE, OCR_BINARY)) console.log('[scan] Built the OCR helper')
  },
})
const worker = createScanWorker({
  db,
  scansDir: SCANS_DIR,
  ocr,
  lookups: createCardLookups(db),
})
const app = createApp({
  db,
  bulk,
  scryfall,
  ai,
  scanner: { scansDir: SCANS_DIR, worker },
  backupDir: BACKUP_DIR,
  webDistDir: fs.existsSync(WEB_DIST_DIR) ? WEB_DIST_DIR : undefined,
})

const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`Binder running at http://localhost:${info.port}`)
  const stale = bulk.staleReason()
  if (stale) {
    console.log(`[card data] ${stale}; refreshing in the background`)
    // start() never rejects; the catch is a backstop so a bug there can't crash the server.
    bulk.start()?.catch((err: unknown) => console.error('[card data]', err))
  }
  // Only the Binder that owns the port picks up scans a restart interrupted: a second one, started while Binder runs,
  // would put the running one's scans back in the queue and then exit on the port error.
  worker.recover()
})
// Another server on the port (Binder already running, say) is said in one line, not as a stack trace.
server.on('error', (err: NodeJS.ErrnoException) => {
  console.error(listenFailure(err, PORT))
  process.exit(1)
})
