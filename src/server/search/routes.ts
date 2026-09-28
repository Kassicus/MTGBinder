import { Hono } from 'hono'
import { z } from 'zod'
import { LIBRARY_ONLY_SORTS } from '../../shared/search/sorts.ts'
import type { DB } from '../db/index.ts'
import { ApiError, parseWith } from '../http.ts'
import { ScryfallError, type ScryfallClient } from '../scryfall/client.ts'
import { SearchQueryError } from './compile.ts'
import { searchLibrary, searchLocal } from './run.ts'
import { searchScryfall } from './scryfall.ts'

const sorts = ['name', 'mv', 'price', 'color', 'rarity'] as const
const Common = {
  q: z.string().max(1000).default(''),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
}
const CardsQuery = z.object({ ...Common, sort: z.enum(sorts).default('name') })
const LibraryQuery = z.object({
  ...Common,
  sort: z.enum([...sorts, ...LIBRARY_ONLY_SORTS]).default('name'),
  view: z.enum(['cards', 'printings']).default('cards'),
})

function requireQuery(q: string): void {
  if (q.trim() === '') throw new ApiError(400, 'empty_query', 'Type something to search for')
}

/** Runs a local search, turning a query mistake into a 400 that points at the problem. */
function local<T>(run: () => T): T {
  try {
    return run()
  } catch (err) {
    if (err instanceof SearchQueryError) throw new ApiError(400, 'bad_query', err.message, err.span)
    throw err
  }
}

function fromScryfall(err: unknown): never {
  if (!(err instanceof ScryfallError)) throw err
  switch (err.code) {
    case 'offline':
      throw new ApiError(503, 'scryfall_offline', `${err.message}. You can search your local card data instead.`)
    case 'rate_limited':
      throw new ApiError(503, 'scryfall_busy', 'Scryfall is limiting requests right now; try again in a minute')
    default:
      if (err.status === 400) throw new ApiError(400, 'bad_query', [err.message, ...err.warnings].join(' '))
      throw new ApiError(502, 'scryfall_error', `Scryfall search failed: ${err.message}`)
  }
}

export function searchRoutes(deps: { db: DB; scryfall: ScryfallClient }): Hono {
  const routes = new Hono()

  routes.get('/library', (c) => {
    const params = parseWith(LibraryQuery, c.req.query())
    return c.json(local(() => searchLibrary(deps.db, params)))
  })

  routes.get('/local', (c) => {
    const params = parseWith(CardsQuery, c.req.query())
    requireQuery(params.q)
    return c.json(local(() => searchLocal(deps.db, params)))
  })

  routes.get('/scryfall', async (c) => {
    const params = parseWith(CardsQuery, c.req.query())
    requireQuery(params.q)
    try {
      return c.json(await searchScryfall(deps.db, deps.scryfall, params))
    } catch (err) {
      fromScryfall(err)
    }
  })

  return routes
}
