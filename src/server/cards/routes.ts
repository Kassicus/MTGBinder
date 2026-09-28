import { Hono } from 'hono'
import { z } from 'zod'
import { NO_OWNERSHIP } from '../../shared/ownership.ts'
import type { CardDetail } from '../../shared/types.ts'
import { getCopies } from '../collection/repo.ts'
import type { DB } from '../db/index.ts'
import { ApiError, parseWith } from '../http.ts'
import { getOwnership } from '../ownership/repo.ts'
import { autocomplete, findCardByName, getCard, getPrintings } from './repo.ts'

const NamedQuery = z.object({ name: z.string().trim().min(1).max(200) })
const AutocompleteQuery = z.object({
  q: z.string().max(200).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(10),
})

export function cardRoutes(deps: { db: DB }): Hono {
  const routes = new Hono()

  routes.get('/autocomplete', (c) => {
    const { q, limit } = parseWith(AutocompleteQuery, c.req.query())
    return c.json(autocomplete(deps.db, q, limit))
  })

  // Brainstorm's [[card]] links (spec §5.5): the card a written name means.
  routes.get('/named', (c) => {
    const card = findCardByName(deps.db, parseWith(NamedQuery, c.req.query()).name)
    if (!card) throw new ApiError(404, 'not_found', 'No card has that name')
    return c.json(card)
  })

  routes.get('/:id', (c) => {
    const card = getCard(deps.db, c.req.param('id'))
    if (!card) throw new ApiError(404, 'not_found', 'Card not found')
    const detail: CardDetail = {
      card,
      printings: getPrintings(deps.db, card.oracleId),
      copies: getCopies(deps.db, card.oracleId),
      ownership: getOwnership(deps.db, [card.oracleId]).get(card.oracleId) ?? NO_OWNERSHIP,
    }
    return c.json(detail)
  })

  return routes
}
