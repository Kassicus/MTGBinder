import path from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createBrainstorm } from './ai/chat.ts'
import type { AiClient } from './ai/client.ts'
import { aiRoutes } from './ai/routes.ts'
import { createBrainstormTools } from './ai/tools.ts'
import type { BulkImporter } from './bulk/import.ts'
import { bulkRoutes } from './bulk/routes.ts'
import { cardRoutes } from './cards/routes.ts'
import { catalogRoutes } from './catalog/routes.ts'
import { collectionRoutes } from './collection/routes.ts'
import { deckRoutes } from './decks/routes.ts'
import type { DB } from './db/index.ts'
import { ApiError, localOnly } from './http.ts'
import { scanRoutes, type ScanService } from './scanner/routes.ts'
import type { ScryfallClient } from './scryfall/client.ts'
import { searchRoutes } from './search/routes.ts'
import { settingsRoutes } from './settings-routes.ts'

export interface AppDeps {
  db: DB
  bulk: BulkImporter
  scryfall: ScryfallClient
  /** The scan queue (spec §5.1); without it there are no /api/scan routes. */
  scanner?: ScanService
  /** The Anthropic API key and client (spec §5.6); without it there are no /api/settings/ai or /api/ai routes. */
  ai?: AiClient
  /** Where backups are kept (spec §5.6); without it there are no /api/settings/backups routes. */
  backupDir?: string
  /** Built SPA directory. When set, non-API requests serve it, falling back to index.html. */
  webDistDir?: string
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      const span = err.span ? { span: err.span } : {}
      return c.json({ error: { code: err.code, message: err.message, ...span } }, err.status)
    }
    console.error(err)
    return c.json({ error: { code: 'internal', message: 'Internal server error' } }, 500)
  })

  app.use('/api/*', localOnly)
  app.get('/api/health', (c) => c.json({ ok: true }))
  app.route('/api/cards', cardRoutes(deps))
  app.route('/api/bulk', bulkRoutes(deps))
  app.route('/api/search', searchRoutes(deps))
  app.route('/api/catalog', catalogRoutes(deps))
  app.route('/api/collection', collectionRoutes(deps))
  app.route('/api/decks', deckRoutes(deps))
  app.route('/api/settings', settingsRoutes(deps))
  if (deps.scanner) app.route('/api/scan', scanRoutes({ db: deps.db, scanner: deps.scanner }))
  if (deps.ai) {
    const tools = createBrainstormTools({ db: deps.db, scryfall: deps.scryfall })
    const brainstorm = createBrainstorm({ db: deps.db, ai: deps.ai, tools })
    app.route('/api/ai', aiRoutes({ db: deps.db, brainstorm, tools }))
  }
  app.all('/api/*', (c) =>
    c.json({ error: { code: 'not_found', message: `No API route for ${c.req.method} ${c.req.path}` } }, 404),
  )

  if (deps.webDistDir) {
    app.use('/*', serveStatic({ root: deps.webDistDir }))
    app.get('*', serveStatic({ path: path.join(deps.webDistDir, 'index.html') }))
  }

  return app
}
