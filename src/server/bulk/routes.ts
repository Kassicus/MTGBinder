import { Hono } from 'hono'
import { ApiError } from '../http.ts'
import type { BulkImporter } from './import.ts'

export function bulkRoutes(deps: { bulk: BulkImporter }): Hono {
  const routes = new Hono()

  routes.get('/status', (c) => c.json(deps.bulk.status()))

  routes.post('/refresh', (c) => {
    const refresh = deps.bulk.start()
    if (refresh === null) {
      throw new ApiError(409, 'already_running', 'A card data refresh is already running')
    }
    // start() never rejects; this backstop keeps a bug there from crashing the server with an unhandled rejection.
    refresh.catch((err: unknown) => console.error('[card data]', err))
    return c.json({ started: true }, 202)
  })

  return routes
}
