import { Hono } from 'hono'
import type { DB } from '../db/index.ts'
import { ApiError } from '../http.ts'
import { getSetDetail, listOwnedSets } from './repo.ts'

/** The Sets pages' data (spec §5.8): the sets with a copy owned, and one set with its cards. */
export function setRoutes(deps: { db: DB }): Hono {
  const routes = new Hono()
  routes.get('/', (c) => c.json(listOwnedSets(deps.db)))
  routes.get('/:code', (c) => {
    const detail = getSetDetail(deps.db, c.req.param('code'))
    if (!detail) throw new ApiError(404, 'not_found', 'No set with that code')
    return c.json(detail)
  })
  return routes
}
