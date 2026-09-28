import { Hono } from 'hono'
import type { DB } from '../db/index.ts'
import { listSets, listTypes } from './catalog.ts'

export function catalogRoutes(deps: { db: DB }): Hono {
  const routes = new Hono()
  routes.get('/sets', (c) => c.json(listSets(deps.db)))
  routes.get('/types', (c) => c.json(listTypes(deps.db)))
  return routes
}
