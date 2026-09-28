import { beforeEach, describe, expect, it } from 'vitest'
import { createBrainstormTools, createdDeckFrom } from '../../src/server/ai/tools.ts'
import type { DB } from '../../src/server/db/index.ts'
import { deckDetail } from '../../src/server/decks/analysis.ts'
import { ScryfallError } from '../../src/server/scryfall/client.ts'
import { stubScryfall } from '../helpers/app.ts'
import { count, createTestDb } from '../helpers/db.ts'
import { fixtureCard } from '../helpers/fixtures.ts'
import { deck, inDeck, own } from '../helpers/library.ts'

let db: DB
let elves: number

// Own 2 Llanowar Elves (one held by the built deck Elves) and 1 Sol Ring.
beforeEach(() => {
  db = createTestDb()
  own(db, 'Llanowar Elves', undefined, 2)
  own(db, 'Sol Ring', undefined, 1)
  elves = deck(db, 'Elves', 'built', 'commander')
  inDeck(db, elves, 'Llanowar Elves', 1)
})

const tools = (scryfall = stubScryfall()) => createBrainstormTools({ db, scryfall })
const run = async (name: string, input: unknown, scryfall = stubScryfall()) =>
  JSON.parse((await tools(scryfall).run(name, input)).content) as Record<string, unknown>

describe('search_my_library', () => {
  it("finds owned cards with the owner's stake in each", async () => {
    expect(await run('search_my_library', { query: 't:elf' })).toEqual({
      total: 1,
      cards: [
        {
          name: 'Llanowar Elves',
          mana_cost: '{G}',
          type: 'Creature — Elf Druid',
          pt: '1/1',
          price_usd: expect.any(Number),
          owned: 2,
          free: 1,
          decks: [`Elves (deck ${elves}, built, 1)`],
        },
      ],
    })
  })

  it('limits results and reports a bad query so Claude can fix it', async () => {
    own(db, 'Forest', undefined, 1)
    expect(((await run('search_my_library', { query: 'mv<=1', limit: 1 })).cards as unknown[]).length).toBe(1)
    await expect(tools().run('search_my_library', { query: 'mv>' })).rejects.toThrow(/^That query isn't valid/)
    await expect(tools().run('search_my_library', { query: '' })).rejects.toThrow()
  })
})

describe('search_scryfall', () => {
  it('searches Scryfall most-played first and marks owned cards', async () => {
    const paths: string[] = []
    const scryfall = stubScryfall({
      getJson: async (path) => {
        paths.push(path)
        return { object: 'list', total_cards: 1, has_more: false, data: [fixtureCard('Sol Ring')] }
      },
    })
    const result = await run('search_scryfall', { query: 'o:"add {c}{c}"' }, scryfall)
    expect(new URLSearchParams(paths[0]!.split('?')[1]).get('order')).toBe('edhrec')
    expect(result).toMatchObject({ total: 1, cards: [{ name: 'Sol Ring', owned: 1, free: 1 }] })
  })

  it('says when Scryfall is offline', async () => {
    const scryfall = stubScryfall({ getJson: () => Promise.reject(new ScryfallError('offline', null, 'fetch failed')) })
    await expect(tools(scryfall).run('search_scryfall', { query: 't:elf' })).rejects.toThrow(/can't be reached/)
  })

  it('passes on what Scryfall ignored in a query', async () => {
    const warning = 'Invalid expression “foo:bar” was ignored. Unknown keyword “foo”.'
    const ignored = new ScryfallError('http', 400, 'All of your terms were ignored.', { warnings: [warning] })
    const scryfall = stubScryfall({ getJson: () => Promise.reject(ignored) })
    await expect(tools(scryfall).run('search_scryfall', { query: 'foo:bar' })).rejects.toThrow(`All of your terms were ignored. ${warning}`)
  })

  it('says when Scryfall itself has a problem', async () => {
    const scryfall = stubScryfall({ getJson: () => Promise.reject(new ScryfallError('http', 503, 'HTTP 503')) })
    await expect(tools(scryfall).run('search_scryfall', { query: 't:elf' })).rejects.toThrow(
      /^Scryfall had a problem; try again later, or search the library$/,
    )
  })
})

describe('get_card', () => {
  it("gives a card's text, legality, and the owner's copies", async () => {
    const card = await run('get_card', { name: 'llanowar elves' })
    expect(card).toMatchObject({
      name: 'Llanowar Elves',
      mana_value: 1,
      oracle_text: '{T}: Add {G}.',
      color_identity: 'G',
      owned: 2,
      free: 1,
      decks: [`Elves (deck ${elves}, built, 1)`],
    })
    expect(card.legal_in).toContain('commander')
    // Copies on a maybe board are said apart: they're only being considered.
    inDeck(db, elves, 'Llanowar Elves', 2, 'maybe')
    const ideas = deck(db, 'Elf Ideas', 'prospective', 'commander')
    inDeck(db, ideas, 'Llanowar Elves', 1, 'maybe')
    expect((await run('get_card', { name: 'llanowar elves' })).decks).toEqual([
      `Elf Ideas (deck ${ideas}, prospective, 0, 1 on maybe)`,
      `Elves (deck ${elves}, built, 1, 2 on maybe)`,
    ])
  })

  it('gives each face of a multi-face card', async () => {
    const card = await run('get_card', { name: 'Fire // Ice' })
    expect((card.faces as Array<{ name: string }>).map((f) => f.name)).toEqual(['Fire', 'Ice'])
  })

  it('suggests close names when none matches', async () => {
    expect(await run('get_card', { name: 'Llanowar Elfs' })).toMatchObject({ name: 'Llanowar Elves' }) // fuzzy ≥ 0.92 resolves
    await expect(tools().run('get_card', { name: 'Llanowar' })).rejects.toThrow(/No card is named "Llanowar"\. Did you mean: Llanowar Elves\?/)
  })
})

describe('get_deck', () => {
  it('reads a deck with the status of every card', async () => {
    const id = deck(db, 'Burn', 'prospective', 'modern')
    inDeck(db, id, 'Lightning Bolt', 4)
    expect(await run('get_deck', { deck_id: id })).toMatchObject({
      name: 'Burn',
      format: 'modern',
      status: 'prospective',
      completion_percent: 0,
      cards: [{ name: 'Lightning Bolt', quantity: 4, board: 'main', status: 'buy', short: 4 }],
    })
    await expect(tools().run('get_deck', { deck_id: 999 })).rejects.toThrow('There is no deck 999.')
  })

  it('finds a deck by name, in any letter case', async () => {
    const id = deck(db, 'Burn', 'prospective', 'modern')
    expect(await run('get_deck', { name: 'burn' })).toMatchObject({ id, name: 'Burn', format: 'modern' })
  })

  it('lists the decks that share a name', async () => {
    const built = deck(db, 'Burn', 'built', 'modern')
    const idea = deck(db, 'BURN', 'prospective', 'modern')
    await expect(tools().run('get_deck', { name: 'Burn' })).rejects.toThrow(
      `Several decks are named "Burn": Burn (deck ${built}, built), BURN (deck ${idea}, prospective). Call get_deck with the deck_id of the one you mean.`,
    )
  })

  it("lists the owner's decks by name, 20 at most, when no deck has the name", async () => {
    const zombies = deck(db, 'Zombies', 'prospective')
    const burn = deck(db, 'burn', 'built', 'modern')
    const message = async () => ((await tools().run('get_deck', { name: 'Elf Ball' }).catch((e: unknown) => e)) as Error).message
    expect(await message()).toBe(
      `There is no deck named "Elf Ball". The owner's decks: burn (deck ${burn}, built), Elves (deck ${elves}, built), Zombies (deck ${zombies}, prospective).`,
    )
    // Made from Deck 20 down to Deck 00; listed by name: burn, Deck 00 … Deck 20, Elves, Zombies.
    const more = Array.from({ length: 21 }, (_, i) => deck(db, `Deck ${String(20 - i).padStart(2, '0')}`, 'prospective'))
    const byName = more.map((id, i) => `Deck ${String(20 - i).padStart(2, '0')} (deck ${id}, prospective)`).reverse()
    const first20 = [`burn (deck ${burn}, built)`, ...byName.slice(0, 19)]
    expect(await message()).toBe(`There is no deck named "Elf Ball". The owner's decks: ${first20.join(', ')}, …and 4 more.`)
  })

  it('says when the owner has no decks', async () => {
    db.prepare('DELETE FROM deck_cards').run()
    db.prepare('DELETE FROM decks').run()
    await expect(tools().run('get_deck', { name: 'Elves' })).rejects.toThrow(/^There is no deck named "Elves"\. The owner has no decks yet\.$/)
  })

  it('takes exactly one of deck_id and name', async () => {
    await expect(tools().run('get_deck', { deck_id: elves, name: 'Elves' })).rejects.toThrow('Give exactly one of deck_id or name.')
    await expect(tools().run('get_deck', {})).rejects.toThrow('Give exactly one of deck_id or name.')
  })
})

describe('create_prospective_deck', () => {
  it('makes a prospective deck from names, boards, and categories, leaving out names it can’t match', async () => {
    const outcome = await tools().run('create_prospective_deck', {
      name: 'Elf Ramp',
      format: 'commander',
      notes: 'Go wide with elves.',
      cards: [
        { name: 'Omnath, Locus of Creation', quantity: 1, board: 'commander' },
        { name: 'llanowar elves', quantity: 1, category: 'Ramp' },
        { name: 'Sol Ring', quantity: 1, category: 'Ramp' },
        { name: 'Elvish Archdruidd', quantity: 1 },
      ],
    })
    expect(outcome.deck).toMatchObject({ name: 'Elf Ramp', format: 'commander', cardCount: 3, unresolved: ['Elvish Archdruidd'] })
    const detail = deckDetail(db, outcome.deck!.id)!
    expect(detail).toMatchObject({ status: 'prospective', notes: 'Go wide with elves.' })
    expect(detail.lines.map((l) => [l.name, l.board, l.category])).toEqual([
      ['Llanowar Elves', 'main', 'Ramp'],
      ['Omnath, Locus of Creation', 'commander', null],
      ['Sol Ring', 'main', 'Ramp'],
    ])
    const content = JSON.parse(outcome.content) as Record<string, unknown>
    expect(content).toMatchObject({ deck_id: outcome.deck!.id, cards: 3, unresolved: ['Elvish Archdruidd'] })
    expect(content).not.toHaveProperty('approximate')
    expect(content).not.toHaveProperty('unpriced_to_buy')
    expect(content).not.toHaveProperty('card_warnings')
  })

  it('lists the names it matched only approximately, with the card each became', async () => {
    const outcome = await tools().run('create_prospective_deck', {
      name: 'Tempo',
      format: 'casual',
      cards: [
        { name: 'Llanowar Elfs', quantity: 1 },
        { name: 'Sol Ring', quantity: 1 },
        { name: 'Brazen Borrower', quantity: 1 },
      ],
    })
    expect(JSON.parse(outcome.content).approximate).toEqual(['Llanowar Elfs → Llanowar Elves'])
    expect(deckDetail(db, outcome.deck!.id)!.lines.map((l) => l.name)).toEqual([
      'Brazen Borrower // Petty Theft',
      'Llanowar Elves',
      'Sol Ring',
    ])
  })

  it('reports copies to buy that have no price, and each card’s warnings', async () => {
    const outcome = await tools().run('create_prospective_deck', {
      name: 'Omnath',
      format: 'commander',
      cards: [
        { name: 'Omnath, Locus of Creation', quantity: 1, board: 'commander' },
        { name: 'Dark Ritual', quantity: 1 },
        { name: 'Command Tower', quantity: 1 },
      ],
    })
    expect(JSON.parse(outcome.content)).toMatchObject({
      unpriced_to_buy: 1,
      card_warnings: ["Dark Ritual: Outside the commander's color identity (B)"],
    })
  })

  it('reports at most 10 card warnings, and how many more there are', async () => {
    const offColor = ['Dark Ritual', 'Thoughtseize', 'Relentless Rats', 'Swamp', 'Tymna the Weaver', 'Lurrus of the Dream-Den']
    const more = ['Grist, the Hunger Tide', 'Atraxa, Praetors\' Voice', 'Black Lotus', 'Emrakul, the Aeons Torn', 'Ancestral Recall']
    const outcome = await tools().run('create_prospective_deck', {
      name: 'Omnath',
      format: 'commander',
      cards: [
        { name: 'Omnath, Locus of Creation', quantity: 1, board: 'commander' },
        ...[...offColor, ...more].map((name) => ({ name, quantity: 1 })),
      ],
    })
    const all = deckDetail(db, outcome.deck!.id)!.lines.flatMap((l) => l.warnings.map((w) => `${l.name}: ${w}`))
    expect(all.length).toBeGreaterThan(10)
    expect(JSON.parse(outcome.content).card_warnings).toEqual([...all.slice(0, 10), `…and ${all.length - 10} more`])
  })

  it('leaves the collection and every existing deck as they were', async () => {
    const burn = deck(db, 'Burn', 'prospective', 'modern')
    inDeck(db, burn, 'Lightning Bolt', 4)
    const library = (except: number) => ({
      collection: db.prepare('SELECT * FROM collection ORDER BY card_id, finish').all(),
      decks: db.prepare('SELECT * FROM decks WHERE id != ? ORDER BY id').all(except),
      lines: db.prepare('SELECT * FROM deck_cards WHERE deck_id != ? ORDER BY id').all(except),
    })
    const before = library(0)
    const outcome = await tools().run('create_prospective_deck', {
      name: 'Elves',
      format: 'commander',
      cards: [
        { name: 'Llanowar Elves', quantity: 4, category: 'Ramp' },
        { name: 'Lightning Bolt', quantity: 1 },
        { name: 'Sol Ring', quantity: 1 },
      ],
    })
    expect(outcome.deck!.id).not.toBe(elves)
    expect(library(outcome.deck!.id)).toEqual(before)
  })

  it('makes nothing when no name matches, and refuses a bad format or too many cards', async () => {
    const before = count(db, 'decks')
    await expect(
      tools().run('create_prospective_deck', { name: 'X', format: 'commander', cards: [{ name: 'Nothing Real', quantity: 1 }] }),
    ).rejects.toThrow(/no deck was made/)
    await expect(tools().run('create_prospective_deck', { name: 'X', format: 'brawl', cards: [{ name: 'Sol Ring', quantity: 1 }] })).rejects.toThrow()
    const cards = Array.from({ length: 251 }, () => ({ name: 'Sol Ring', quantity: 1 }))
    await expect(tools().run('create_prospective_deck', { name: 'X', format: 'commander', cards })).rejects.toThrow(/<=250 items/)
    expect(count(db, 'decks')).toBe(before)
  })
})

describe('bad input', () => {
  it('explains a bad call briefly, however many problems it has', async () => {
    const cards = Array.from({ length: 250 }, () => ({ quantity: 1 }))
    const err = await tools()
      .run('create_prospective_deck', { name: 'X', format: 'commander', cards })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    const message = (err as Error).message
    expect(message).toMatch(/^✖ Invalid input: expected string, received undefined\n {2}→ at cards\[0\]\.name\n/)
    expect(message).toMatch(/\n…and 245 more$/)
    expect(message.split('\n')).toHaveLength(11)
  })
})

describe('activity lines', () => {
  it('say what each call does', () => {
    const t = tools()
    expect(t.describe('search_my_library', { query: 't:elf' })).toBe('Searching your library for `t:elf`')
    expect(t.describe('search_scryfall', { query: 'id:g' })).toBe('Searching Scryfall for `id:g`')
    expect(t.describe('get_card', { name: 'Sol Ring' })).toBe('Looking up Sol Ring')
    expect(t.describe('get_deck', { deck_id: elves })).toBe('Reading Elves')
    expect(t.describe('get_deck', { deck_id: 999 })).toBe('Reading deck 999')
    expect(t.describe('get_deck', { name: 'Elves' })).toBe('Reading Elves')
    expect(t.describe('create_prospective_deck', { name: 'Elf Ramp', cards: [{ quantity: 1 }, { quantity: 4 }] })).toBe(
      'Creating the deck “Elf Ramp” (5 cards)',
    )
    expect(t.describe('create_prospective_deck', { name: 'Elf Ramp', cards: [{ quantity: 1 }] })).toBe('Creating the deck “Elf Ramp” (1 card)')
  })

  it('never fail, whatever the input', () => {
    const t = tools()
    expect(t.describe('create_prospective_deck', { name: 'Elf Ramp', cards: [null, { quantity: 2 }] })).toBe(
      'Creating the deck “Elf Ramp” (2 cards)',
    )
    expect(t.describe('create_prospective_deck', { name: 'Elf Ramp', cards: [{ quantity: 1 }, null] })).toBe(
      'Creating the deck “Elf Ramp” (1 card)',
    )
    expect(t.describe('get_card', 'Sol Ring')).toBe('Using get_card')
    expect(t.describe('get_card', null)).toBe('Using get_card')
    const broken = {
      get name(): string {
        throw new Error('unreadable')
      },
    }
    expect(t.describe('get_card', broken)).toBe('Using get_card')
  })

  it('reads a created deck back from its tool result', () => {
    expect(createdDeckFrom('not json')).toBeNull()
    expect(createdDeckFrom('{"total": 1}')).toBeNull()
  })
})
