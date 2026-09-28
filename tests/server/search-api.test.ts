import { describe, expect, it, vi } from 'vitest'
import { scryfallToRow, type CardRow } from '../../src/server/cards/map.ts'
import { insertCardRows } from '../../src/server/cards/repo.ts'
import { ScryfallError } from '../../src/server/scryfall/client.ts'
import { searchScryfall } from '../../src/server/search/scryfall.ts'
import type { ScryfallCard, ScryfallList } from '../../src/server/scryfall/types.ts'
import type { SetInfo, TypeCatalog } from '../../src/server/catalog/catalog.ts'
import type { ApiErrorBody, SearchPage } from '../../src/shared/types.ts'
import { body, makeApp, stubScryfall } from '../helpers/app.ts'
import { createTestDb } from '../helpers/db.ts'
import { fixtureCard, syntheticCard } from '../helpers/fixtures.ts'
import { deck, inDeck, own } from '../helpers/library.ts'

function scryfallList(cards: ScryfallCard[], extra: Partial<ScryfallList<ScryfallCard>> = {}): ScryfallList<ScryfallCard> {
  return { object: 'list', data: cards, has_more: false, total_cards: cards.length, ...extra }
}

describe('GET /api/search/scryfall', () => {
  it('asks Scryfall for paper cards, one per card, and marks what I own', async () => {
    const db = createTestDb()
    own(db, 'Lightning Bolt', 'm10', 2)
    const burn = deck(db, 'Burn', 'built', 'modern')
    inDeck(db, burn, 'Lightning Bolt', 4)
    const getJson = vi.fn(async (_path: string) => scryfallList([fixtureCard('Lightning Bolt', 'sta'), fixtureCard('Lightning Helix')], { total_cards: 2, warnings: ['x ignored'] }))
    const res = await makeApp({ db, scryfall: stubScryfall({ getJson }) }).request('/api/search/scryfall?q=t%3Ainstant%20c%3Ar&sort=price&dir=desc&page=2')
    expect(res.status).toBe(200)
    const url = new URL(`https://api.scryfall.com${getJson.mock.calls[0]?.[0]}`)
    expect(url.pathname).toBe('/cards/search')
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 't:instant c:r', unique: 'cards', order: 'usd', dir: 'desc', page: '2' })
    const page = await body<SearchPage>(res)
    expect(page).toMatchObject({ total: 2, page: 2, pageSize: 175, hasMore: false, warnings: ['x ignored'] })
    expect(page.cards.map((c) => [c.name, c.setCode, c.ownership.owned, c.ownership.free])).toEqual([
      ['Lightning Bolt', 'sta', 2, -2],
      ['Lightning Helix', 'mkm', 0, 0],
    ])
  })

  it("can ask for one of Scryfall's own orders, such as most-played first", async () => {
    const getJson = vi.fn(async (_path: string) => scryfallList([]))
    await searchScryfall(createTestDb(), stubScryfall({ getJson }), { q: 't:elf', sort: 'name', order: 'edhrec', dir: 'asc', page: 1 })
    expect(new URL(`https://api.scryfall.com${getJson.mock.calls[0]?.[0]}`).searchParams.get('order')).toBe('edhrec')
  })

  it('drops digital-only cards from the page', async () => {
    const digital = { ...fixtureCard('Grizzly Bears'), id: 'digital-only', name: 'A-Grizzly Bears', digital: true, games: ['arena'] }
    const getJson = async () => scryfallList([fixtureCard('Grizzly Bears'), digital])
    const page = await body<SearchPage>(await makeApp({ scryfall: stubScryfall({ getJson }) }).request('/api/search/scryfall?q=bears'))
    expect(page.cards.map((c) => c.name)).toEqual(['Grizzly Bears'])
    // The whole search fit on this page, so its total is what's left.
    expect([page.total, page.estimated]).toEqual([1, false])
  })

  it("gives Scryfall's total as an estimate when the search runs to more pages", async () => {
    const getJson = async () => scryfallList([fixtureCard('Grizzly Bears')], { has_more: true, total_cards: 412 })
    const page = await body<SearchPage>(await makeApp({ scryfall: stubScryfall({ getJson }) }).request('/api/search/scryfall?q=bears'))
    expect([page.total, page.estimated, page.hasMore]).toEqual([412, true, true])
  })

  it('returns an empty page for a page past the last', async () => {
    const pastTheEnd = new ScryfallError('http', 422, 'You have paginated beyond the end of these results')
    const app = makeApp({ scryfall: stubScryfall({ getJson: () => Promise.reject(pastTheEnd) }) })
    const res = await app.request('/api/search/scryfall?q=t%3Aelf&page=9')
    expect(res.status).toBe(200)
    expect(await body(res)).toMatchObject({ total: 0, page: 9, cards: [], hasMore: false })
    // On the first page, a 422 is a real failure.
    expect((await app.request('/api/search/scryfall?q=t%3Aelf')).status).toBe(502)
  })

  it('returns an empty page when nothing matches', async () => {
    const getJson = () => Promise.reject(new ScryfallError('not_found', 404, "Your query didn't match any cards."))
    const res = await makeApp({ scryfall: stubScryfall({ getJson }) }).request('/api/search/scryfall?q=zzzz')
    expect(res.status).toBe(200)
    expect(await body(res)).toMatchObject({ total: 0, cards: [], hasMore: false })
  })

  it.each([
    [new ScryfallError('offline', null, 'Scryfall is unreachable: fetch failed'), 503, 'scryfall_offline'],
    [new ScryfallError('rate_limited', 429, 'slow down'), 503, 'scryfall_busy'],
    [new ScryfallError('http', 400, 'All of your terms were ignored.', { warnings: ['Unknown keyword "foo".'] }), 400, 'bad_query'],
    [new ScryfallError('http', 500, 'HTTP 500'), 502, 'scryfall_error'],
  ])('maps %s to an HTTP error', async (error, status, code) => {
    const res = await makeApp({ scryfall: stubScryfall({ getJson: () => Promise.reject(error) }) }).request('/api/search/scryfall?q=x')
    expect(res.status).toBe(status)
    expect((await body<ApiErrorBody>(res)).error.code).toBe(code)
  })

  it('includes Scryfall warnings in a bad-query message', async () => {
    const error = new ScryfallError('http', 400, 'All of your terms were ignored.', { warnings: ['Unknown keyword "foo".'] })
    const res = await makeApp({ scryfall: stubScryfall({ getJson: () => Promise.reject(error) }) }).request('/api/search/scryfall?q=foo:bar')
    expect((await body<ApiErrorBody>(res)).error.message).toBe('All of your terms were ignored. Unknown keyword "foo".')
  })

  it('requires a query and rejects sorting by date added or quantity (My library only)', async () => {
    expect((await makeApp().request('/api/search/scryfall?q=%20')).status).toBe(400)
    expect((await makeApp().request('/api/search/scryfall?q=bolt&sort=added')).status).toBe(400)
    expect((await makeApp().request('/api/search/scryfall?q=bolt&sort=quantity')).status).toBe(400)
  })
})

describe('GET /api/search/local', () => {
  it('searches the local card data', async () => {
    const res = await makeApp().request('/api/search/local?q=c%3Awu')
    expect(res.status).toBe(200)
    expect((await body<SearchPage>(res)).cards.map((c) => c.name)).toEqual(["Atraxa, Praetors' Voice", 'Omnath, Locus of Creation', 'Teferi, Time Raveler'])
  })

  it('reports a query mistake with its position', async () => {
    const res = await makeApp().request(`/api/search/local?q=${encodeURIComponent('t:elf foo:bar')}`)
    expect(res.status).toBe(400)
    expect(await body(res)).toEqual({ error: { code: 'bad_query', message: 'Unknown search key "foo"', span: { start: 6, end: 9 } } })
  })

  it('refuses library-only keys and empty queries', async () => {
    const res = await makeApp().request('/api/search/local?q=in%3Adeck')
    expect(res.status).toBe(400)
    expect((await body<ApiErrorBody>(res)).error).toMatchObject({ code: 'bad_query', span: { start: 0, end: 7 } })
    expect(await body(await makeApp().request('/api/search/local'))).toEqual({ error: { code: 'empty_query', message: 'Type something to search for' } })
  })
})

describe('GET /api/search/library', () => {
  it('lists the collection (empty query allowed) in either view', async () => {
    const db = createTestDb()
    own(db, 'Lightning Bolt', 'm10', 2)
    own(db, 'Lightning Bolt', 'm11', 1, 'foil')
    const app = makeApp({ db })
    const cards = await body<SearchPage>(await app.request('/api/search/library'))
    expect(cards.cards.map((c) => [c.name, c.quantity])).toEqual([['Lightning Bolt', 3]])
    const printings = await body<SearchPage>(await app.request('/api/search/library?view=printings&sort=added'))
    expect(printings.cards.map((c) => [c.setCode, c.finish])).toEqual([['m10', 'nonfoil'], ['m11', 'foil']])
    const byQuantity = await body<SearchPage>(await app.request('/api/search/library?view=printings&sort=quantity&dir=desc'))
    expect(byQuantity.cards.map((c) => [c.setCode, c.quantity])).toEqual([['m10', 2], ['m11', 1]])
  })

  it('validates parameters', async () => {
    expect((await makeApp().request('/api/search/library?view=grid')).status).toBe(400)
    expect((await makeApp().request('/api/search/library?page=0')).status).toBe(400)
  })
})

describe('GET /api/catalog', () => {
  it('lists sets newest first', async () => {
    const sets = await body<SetInfo[]>(await makeApp().request('/api/catalog/sets'))
    expect(sets[0]).toEqual({ code: expect.any(String), name: expect.any(String), releasedAt: expect.any(String) })
    expect(sets.find((s) => s.code === 'm21')).toEqual({ code: 'm21', name: 'Core Set 2021', releasedAt: '2020-07-03' })
    const dates = sets.map((s) => s.releasedAt)
    expect([...dates].sort().reverse()).toEqual(dates)
  })

  it('splits type-line words into supertypes, types, and subtypes', async () => {
    const types = await body<TypeCatalog>(await makeApp().request('/api/catalog/types'))
    expect(types.supertypes).toEqual(['Basic', 'Legendary'])
    expect(types.types).toEqual(expect.arrayContaining(['Artifact', 'Battle', 'Creature', 'Instant', 'Land', 'Planeswalker', 'Sorcery']))
    expect(types.types).not.toContain('Legendary')
    expect(types.subtypes).toEqual(expect.arrayContaining(['Angel', 'Elf', 'Forest', 'Siege']))
  })

  it('keeps a subtype of two words whole', async () => {
    const db = createTestDb()
    insertCardRows(db, 'cards', [scryfallToRow(syntheticCard({ name: 'The Doctor', type_line: 'Legendary Creature — Time Lord Doctor' })) as CardRow])
    const { subtypes } = await body<TypeCatalog>(await makeApp({ db }).request('/api/catalog/types'))
    expect(subtypes).toEqual(expect.arrayContaining(['Time Lord', 'Doctor']))
    expect(subtypes).not.toContain('Time')
    expect(subtypes).not.toContain('Lord')
  })
})
