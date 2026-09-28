import { beforeEach, describe, expect, it } from 'vitest'
import { scryfallToRow, type CardRow } from '../../src/server/cards/map.ts'
import { insertCardRows, rebuildCardNames } from '../../src/server/cards/repo.ts'
import { previewDeckImport } from '../../src/server/decks/import.ts'
import type { DB } from '../../src/server/db/index.ts'
import type { ScryfallCardFace } from '../../src/server/scryfall/types.ts'
import type { ApiErrorBody, DeckDetail, DeckImportPreview, DeckSummary } from '../../src/shared/types.ts'
import { body, makeApp } from '../helpers/app.ts'
import { createTestDb } from '../helpers/db.ts'
import { fixtureCard, syntheticCard } from '../helpers/fixtures.ts'
import { own } from '../helpers/library.ts'

let db: DB
let app: ReturnType<typeof makeApp>
beforeEach(() => {
  db = createTestDb()
  app = makeApp({ db })
})

const send = (method: string, path: string, json?: unknown) =>
  app.request(path, json === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) })
const errorCode = async (res: Response) => (await body<ApiErrorBody>(res)).error.code
async function newDeck(fields: Record<string, unknown> = { name: 'Burn', format: 'modern' }): Promise<DeckSummary> {
  return body<DeckSummary>(await send('POST', '/api/decks', fields))
}
const bolt = (set = 'm10') => fixtureCard('Lightning Bolt', set).id

describe('decks', () => {
  it('creates, lists, renames, marks built, duplicates, and deletes decks', async () => {
    const created = await newDeck()
    expect(created).toMatchObject({ name: 'Burn', format: 'modern', status: 'prospective', notes: '', cardCount: 0 })
    expect((await body<DeckSummary[]>(await app.request('/api/decks'))).map((d) => d.name)).toEqual(['Burn'])
    const renamed = await body<DeckSummary>(await send('PATCH', `/api/decks/${created.id}`, { name: 'Mono-Red Burn', status: 'built' }))
    expect(renamed).toMatchObject({ name: 'Mono-Red Burn', status: 'built' })
    const copy = await send('POST', `/api/decks/${created.id}/duplicate`)
    expect([copy.status, (await body<DeckSummary>(copy)).name]).toEqual([201, 'Mono-Red Burn (copy)'])
    expect((await send('DELETE', `/api/decks/${created.id}`)).status).toBe(204)
    expect((await app.request(`/api/decks/${created.id}`)).status).toBe(404)
  })

  it('validates deck fields', async () => {
    for (const bad of [{ name: '', format: 'modern' }, { name: 'X', format: 'brawl' }, { name: 'X', format: 'modern', status: 'owned' }]) {
      const res = await send('POST', '/api/decks', bad)
      expect([res.status, await errorCode(res)]).toEqual([400, 'bad_request'])
    }
    expect((await send('PATCH', '/api/decks/abc', { name: 'X' })).status).toBe(404)
  })

  it('names a deck or line only by its plain id: 0x1, 1e0, 01 and 1.0 are no id', async () => {
    const id = (await body<DeckSummary>(await send('POST', '/api/decks', { name: 'Burn', format: 'modern' }))).id
    expect(id).toBe(1)
    expect((await app.request('/api/decks/1')).status).toBe(200)
    for (const alias of ['0x1', '1e0', '01', '1.0', '%201', '-1', '0']) {
      expect([alias, (await app.request(`/api/decks/${alias}`)).status]).toEqual([alias, 404])
      expect([alias, (await send('DELETE', `/api/decks/1/lines/${alias}`)).status]).toEqual([alias, 404])
    }
  })

  it('adds cards, edits and removes lines, and returns the detail', async () => {
    own(db, 'Lightning Bolt', 'm10', 2)
    const { id } = await newDeck()
    expect(await body(await send('POST', `/api/decks/${id}/cards`, { cardId: bolt(), delta: 4 }))).toEqual({ quantity: 4 })
    let detail = await body<DeckDetail>(await app.request(`/api/decks/${id}`))
    expect(detail.lines).toMatchObject([{ name: 'Lightning Bolt', board: 'main', quantity: 4, owned: 2, short: 2, status: 'buy' }])
    const lineId = detail.lines[0]!.id
    expect((await send('PATCH', `/api/decks/${id}/lines/${lineId}`, { quantity: 2, category: 'Burn' })).status).toBe(204)
    detail = await body<DeckDetail>(await app.request(`/api/decks/${id}`))
    expect(detail.lines[0]).toMatchObject({ quantity: 2, category: 'Burn', status: 'owned' })
    const wrong = await send('PATCH', `/api/decks/${id}/lines/${lineId}`, { preferredCardId: fixtureCard('Sol Ring').id })
    expect([wrong.status, await errorCode(wrong)]).toEqual([400, 'wrong_card'])
    expect((await send('DELETE', `/api/decks/${id}/lines/${lineId}`)).status).toBe(204)
    expect((await send('DELETE', `/api/decks/${id}/lines/${lineId}`)).status).toBe(404)
  })

  it('404s unknown decks and cards, and 400s bad card bodies', async () => {
    const { id } = await newDeck()
    expect((await send('POST', '/api/decks/999/cards', { cardId: bolt() })).status).toBe(404)
    const missing = await send('POST', `/api/decks/${id}/cards`, { cardId: 'nope' })
    expect([missing.status, await body(missing)]).toEqual([
      404,
      { error: { code: 'not_found', message: "That printing isn't in your local card data yet; refresh card data in Settings." } },
    ])
    for (const bad of [{ cardId: bolt(), delta: 0 }, { cardId: bolt(), board: 'deck' }, {}]) {
      expect((await send('POST', `/api/decks/${id}/cards`, bad)).status).toBe(400)
    }
    const notJson = await app.request(`/api/decks/${id}/cards`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"cardId": ' })
    expect([notJson.status, await errorCode(notJson)]).toEqual([400, 'bad_request'])
  })

  it('previews and imports a decklist, all or nothing', async () => {
    const { id } = await newDeck({ name: 'Idea', format: 'commander' })
    const preview = await body<DeckImportPreview>(await send('POST', `/api/decks/${id}/import/preview`, { text: "Commander\n1 Atraxa, Praetors' Voice\nDeck\n1 Sol Ring\n1 Nope" }))
    expect(preview.counts).toEqual({ exact: 2, face: 0, fuzzy: 0, unresolved: 1 })
    const items = preview.rows.flatMap((r) => (r.card ? [{ oracleId: r.card.oracleId, cardId: r.card.cardId, quantity: r.quantity, board: r.board }] : []))
    expect(await body(await send('POST', `/api/decks/${id}/import`, { items }))).toEqual({ lines: 2, copies: 2 })
    const bad = await send('POST', `/api/decks/${id}/import`, { items: [...items, { oracleId: 'nope', cardId: null, quantity: 1, board: 'main' }] })
    expect([bad.status, await errorCode(bad)]).toEqual([400, 'bad_import'])
    expect((await body<DeckDetail>(await app.request(`/api/decks/${id}`))).cardCount).toBe(2)
  })

  it('imports with replace: true, replacing the lines already in the deck', async () => {
    const { id } = await newDeck()
    await send('POST', `/api/decks/${id}/cards`, { cardId: bolt(), delta: 4 })
    await send('POST', `/api/decks/${id}/cards`, { cardId: fixtureCard('Fireball').id, board: 'side', delta: 1 })
    const sol = fixtureCard('Sol Ring')
    const items = [{ oracleId: sol.oracle_id, cardId: null, quantity: 1, board: 'main' }]
    expect(await body(await send('POST', `/api/decks/${id}/import`, { items, replace: true }))).toEqual({ lines: 1, copies: 1 })
    const detail = await body<DeckDetail>(await app.request(`/api/decks/${id}`))
    expect(detail.lines.map((l) => [l.name, l.board, l.quantity])).toEqual([['Sol Ring', 'main', 1]])
  })

  it('previews at most 5,000 card lines', async () => {
    const { id } = await newDeck()
    const atCap = await send('POST', `/api/decks/${id}/import/preview`, { text: '1 Sol Ring\n'.repeat(5000) })
    expect([atCap.status, (await body<DeckImportPreview>(atCap)).rows.length]).toEqual([200, 5000])
    const over = await send('POST', `/api/decks/${id}/import/preview`, { text: '1 Sol Ring\n'.repeat(5001) })
    const error = (await body<ApiErrorBody>(over)).error
    expect([over.status, error.code]).toEqual([400, 'bad_request'])
    expect(error.message).toMatch(/at most 5,000 card lines/)
  })

  it('exports Arena and MTGO text', async () => {
    const { id } = await newDeck()
    await send('POST', `/api/decks/${id}/cards`, { cardId: bolt(), delta: 4 })
    await send('POST', `/api/decks/${id}/cards`, { cardId: fixtureCard('Fireball').id, board: 'side', delta: 1 })
    expect(await (await app.request(`/api/decks/${id}/export`)).text()).toBe('Deck\n4 Lightning Bolt (M10) 146\n\nSideboard\n1 Fireball (CLB) 175\n')
    expect(await (await app.request(`/api/decks/${id}/export?format=mtgo`)).text()).toBe('4 Lightning Bolt\n\n1 Fireball\n')
    // A card gone from the card data has no name to export: the rest still exports.
    db.prepare("UPDATE deck_cards SET oracle_id = 'gone' WHERE board = 'side'").run()
    expect(await (await app.request(`/api/decks/${id}/export?format=mtgo`)).text()).toBe('4 Lightning Bolt\n')
  })

  it('exports multi-face cards by their front face, except split and aftermath cards, and reads the export back', async () => {
    const face = (name: string): ScryfallCardFace => ({ name, mana_cost: '{R}', type_line: 'Instant', oracle_text: '' })
    const boltOracle = fixtureCard('Lightning Bolt').oracle_id
    const reversible = syntheticCard({ oracle_id: boltOracle, name: 'Lightning Bolt // Lightning Bolt', layout: 'reversible_card', set: 'sld', set_type: 'box', collector_number: '1990', card_faces: [face('Lightning Bolt'), face('Lightning Bolt')] })
    const aftermath = syntheticCard({ name: 'Commit // Memory', layout: 'aftermath', set: 'akh', set_type: 'expansion', collector_number: '211', card_faces: [face('Commit'), face('Memory')] })
    insertCardRows(db, 'cards', [reversible, aftermath].map((c) => scryfallToRow(c) as CardRow))
    rebuildCardNames(db)
    const { id } = await newDeck({ name: 'Faces', format: 'casual' })
    const cards: Array<[string, string]> = [
      [fixtureCard('Delver of Secrets // Insectile Aberration').id, 'main'], // transform
      [fixtureCard('Brazen Borrower // Petty Theft').id, 'main'], // adventure
      [fixtureCard('Fire // Ice').id, 'main'], // split
      [aftermath.id, 'main'],
      [reversible.id, 'main'],
      [fixtureCard('Bushi Tenderfoot // Kenzo the Hardhearted').id, 'side'], // flip
      [fixtureCard("Agadeem's Awakening // Agadeem, the Undercrypt").id, 'side'], // modal double-faced
    ]
    for (const [cardId, board] of cards) await send('POST', `/api/decks/${id}/cards`, { cardId, board })

    const arena = await (await app.request(`/api/decks/${id}/export`)).text()
    expect(arena).toBe(
      'Deck\n1 Brazen Borrower (SOC) 190\n1 Commit // Memory (AKH) 211\n1 Delver of Secrets (INR) 60\n1 Fire // Ice (DMR) 215\n1 Lightning Bolt (SLD) 1990\n\n' +
        "Sideboard\n1 Agadeem's Awakening (ZNR) 90\n1 Bushi Tenderfoot (CHK) 2\n",
    )
    const mtgo = await (await app.request(`/api/decks/${id}/export?format=mtgo`)).text()
    expect(mtgo).toBe("1 Brazen Borrower\n1 Commit // Memory\n1 Delver of Secrets\n1 Fire // Ice\n1 Lightning Bolt\n\n1 Agadeem's Awakening\n1 Bushi Tenderfoot\n")

    // Both read back as the same cards (and, from Arena, the same printings).
    const { lines } = await body<DeckDetail>(await app.request(`/api/decks/${id}`))
    const sorted = (rows: unknown[][]) => rows.map((r) => JSON.stringify(r)).sort()
    const inDeck = (printing: boolean) => sorted(lines.map((l) => [l.board, l.quantity, l.oracleId, printing ? l.cardId : null]))
    const readBack = (text: string, printing: boolean) =>
      sorted(previewDeckImport(db, text).rows.map((r) => [r.board, r.quantity, r.card?.oracleId ?? null, printing ? (r.card?.cardId ?? null) : null]))
    expect(readBack(arena, true)).toEqual(inDeck(true))
    expect(readBack(mtgo, false)).toEqual(inDeck(false))
  })

  it('refuses a deck change from another site', async () => {
    const res = await app.request('/api/decks', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ name: 'X', format: 'modern' }) })
    expect(res.status).toBe(403)
  })
})
