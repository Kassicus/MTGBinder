import { beforeAll, describe, expect, it } from 'vitest'
import { scryfallToRow } from '../../src/server/cards/map.ts'
import { insertCardRows, rebuildCardNames } from '../../src/server/cards/repo.ts'
import type { DB } from '../../src/server/db/index.ts'
import { createCardLookups } from '../../src/server/scanner/lookups.ts'
import { decide, hasText, readCard, type CardLookups, type CardReading } from '../../src/server/scanner/matcher.ts'
import type { OcrLine } from '../../src/server/scanner/ocr-client.ts'
import { createTestDb } from '../helpers/db.ts'
import { fixtureCard, syntheticCard } from '../helpers/fixtures.ts'

/** An OCR line at height `y` (top of the box, 0–1), `x` from the left. */
const line = (text: string, y: number, x = 0.08, h = 0.03): OcrLine => ({ text, confidence: 1, box: { x, y, w: 0.5, h } })
const ocr = (...lines: OcrLine[]) => ({ width: 672, height: 936, lines })

describe('readCard', () => {
  it('reads a modern card: title, set code, collector number, and copyright year', () => {
    const reading = readCard(
      ocr(
        line('Goblin Rabblemaster', 0.06),
        line('2', 0.062, 0.82),
        line('Creature - Goblin Warrior', 0.575),
        line('put a 1/1 red Goblin creature token with', 0.741),
        line('gets +1/+0 until end of turn for each other', 0.844),
        line('2/2', 0.902, 0.818),
        line('145/269 R', 0.934, 0.062, 0.015),
        line('M15 • EN SVETLIN VELINOV', 0.951, 0.063, 0.019),
        line('TM & © 2014 Wizards of the Coast', 0.951, 0.595, 0.017),
      ),
    )
    expect(reading).toMatchObject({ title: 'Goblin Rabblemaster', setCode: 'm15', collectorNumber: '145', year: 2014, foil: false })
  })

  it('reads the 2020s collector line, where a ★ instead of • marks a foil (on-device OCR reads the ★ as *)', () => {
    const reading = readCard(
      ocr(line('Ash, Party Crasher', 0.06), line('U 0201', 0.936, 0.065, 0.015), line('WOE * EN JASON RAINVILLE', 0.953, 0.06, 0.017)),
    )
    expect(reading).toMatchObject({ title: 'Ash, Party Crasher', setCode: 'woe', collectorNumber: '201', foil: true })
    const star = readCard(ocr(line('Ash, Party Crasher', 0.06), line('U 0201', 0.936, 0.065, 0.015), line('WOE ★ EN JASON RAINVILLE', 0.953, 0.06, 0.017)))
    expect(star).toMatchObject({ setCode: 'woe', foil: true })
  })

  it('reads a • or · on the collector line as nonfoil', () => {
    for (const mark of ['•', '·']) {
      const reading = readCard(ocr(line('Ash, Party Crasher', 0.06), line('U 0201', 0.936, 0.065, 0.015), line(`WOE ${mark} EN JASON RAINVILLE`, 0.953, 0.06, 0.017)))
      expect(reading).toMatchObject({ setCode: 'woe', foil: false })
    }
  })

  it('reads a 2003–2014 card, whose number sits at the end of the copyright line and which prints no set code', () => {
    const reading = readCard(
      ocr(
        line('Clone', 0.06),
        line('The shapeshifter mimics with a twin', 0.792),
        line('0/0', 0.904, 0.795),
        line('TM & C 1993-2009 Wizards of the Coast LIC 45/249', 0.947, 0.083, 0.015),
      ),
    )
    expect(reading).toMatchObject({ title: 'Clone', setCode: null, collectorNumber: '45', year: 2009 })
  })

  it("never takes power/toughness for a collector number, and keeps a double-faced card's letter", () => {
    expect(readCard(ocr(line('Grizzly Bears', 0.06), line('2/2', 0.9, 0.8), line('Illus. Someone', 0.93))).collectorNumber).toBeNull()
    expect(readCard(ocr(line('Screeching Bat', 0.06), line('TM & © 1993-2011 Wizards 114a/264', 0.947))).collectorNumber).toBe('114a')
  })

  it('finds the title and collector line of a card that sits lower and smaller in the photo', () => {
    // The card fills the middle 80% of the photo: positions count from the card's highest to its lowest text.
    const at = (y: number) => 0.1 + y * 0.8
    const reading = readCard(
      ocr(line('Shiko, Paragon of the Way', at(0.06)), line('Legendary Creature', at(0.575)), line('M 0223', at(0.936), 0.07, 0.012), line('TDM • EN', at(0.951), 0.07, 0.014)),
    )
    expect(reading).toMatchObject({ title: 'Shiko, Paragon of the Way', setCode: 'tdm', collectorNumber: '223' })
  })

  it('tells a card from the bare scanning area', () => {
    expect(hasText(ocr(line('Lightning Bolt', 0.06)))).toBe(true)
    expect(hasText(ocr(line('•', 0.5), line('12', 0.7)))).toBe(false)
    expect(readCard(ocr()).title).toBeNull()
  })
})

describe('decide', () => {
  let db: DB
  let lookups: CardLookups
  beforeAll(() => {
    db = createTestDb()
    lookups = createCardLookups(db)
  })
  const reading = (r: Partial<CardReading>): CardReading => ({
    title: null, setCode: null, collectorNumber: null, year: null, foil: false, texts: r.title ? [r.title] : [],
    collectorNumbers: r.collectorNumber ? [r.collectorNumber] : [], ...r,
  })
  /** Lookups over the fixtures plus these synthetic printings. */
  const lookupsWith = (...cards: Array<Parameters<typeof syntheticCard>[0]>) => {
    const scratch = createTestDb()
    insertCardRows(scratch, 'cards', cards.map((card) => scryfallToRow(syntheticCard(card))!))
    rebuildCardNames(scratch)
    return createCardLookups(scratch)
  }
  const id = (name: string, set: string) => fixtureCard(name, set).id
  const outcome = (r: Partial<CardReading>) => {
    const d = decide(reading(r), lookups)
    return [d.outcome, d.card?.id ?? null]
  }

  it('is confident when the set code and number name a printing whose name is on the card', () => {
    expect(outcome({ title: 'Lightning Bolt', setCode: 'm11', collectorNumber: '149' })).toEqual(['confident', id('Lightning Bolt', 'm11')])
    // Split cards print their names sideways, outside the title bar: any line on the card counts.
    expect(outcome({ texts: ['Fire', 'Ice', 'Instant'], setCode: 'dmr', collectorNumber: '215' })).toEqual(['confident', id('Fire // Ice', 'dmr')])
  })

  it('tries set codes one character off when the one read names nothing, still checking the name', () => {
    expect(outcome({ title: 'Lightning Bolt', setCode: 'stb', collectorNumber: '42' })).toEqual(['confident', id('Lightning Bolt', 'sta')])
    expect(outcome({ title: 'Sol Ring', setCode: 'stb', collectorNumber: '42' })[0]).not.toBe('confident')
  })

  it('falls back to the title when the set and number name a different card', () => {
    // m10 #146 is Lightning Bolt; the title says Sol Ring, whose two printings the number doesn't narrow.
    expect(outcome({ title: 'Sol Ring', setCode: 'm10', collectorNumber: '146' })).toEqual(['printing', id('Sol Ring', 'c21')])
  })

  it('is confident about a name alone when only one English printing could be it', () => {
    expect(outcome({ title: 'Tarmogoyf' })).toEqual(['confident', id('Tarmogoyf', 'fra')])
  })

  it('narrows printings by collector number, set code, or copyright year; one left is the printing', () => {
    expect(outcome({ title: 'Lightning Bolt', collectorNumber: '42' })).toEqual(['confident', id('Lightning Bolt', 'sta')])
    expect(outcome({ title: 'Lightning Bolt', setCode: 'm10' })).toEqual(['confident', id('Lightning Bolt', 'm10')])
    // The year printed or the next (a set out in January carries the year before): 2010–2011 leaves only M11.
    expect(outcome({ title: 'Lightning Bolt', year: 2010 })).toEqual(['confident', id('Lightning Bolt', 'm11')])
  })

  it("is unsure of the printing, offering the likeliest, when what's read doesn't leave one; a misread doesn't narrow", () => {
    expect(outcome({ title: 'Lightning Bolt' })).toEqual(['printing', id('Lightning Bolt', 'm11')])
    expect(outcome({ title: 'Lightning Bolt', year: 2009 })).toEqual(['printing', id('Lightning Bolt', 'm11')]) // M10 or M11
    expect(outcome({ title: 'Lightning Bolt', collectorNumber: '999', year: 1994 })).toEqual(['printing', id('Lightning Bolt', 'm11')])
  })

  it('reads through OCR slips in the title, and matches a face name', () => {
    expect(outcome({ title: 'Lightnirg Bolt', setCode: 'm10' })).toEqual(['confident', id('Lightning Bolt', 'm10')])
    expect(outcome({ title: 'Insectile Aberration' })).toEqual(['confident', id('Delver of Secrets // Insectile Aberration', 'inr')])
  })

  it("is unsure of the card when two names are about as close, or nothing is close, and lists what's close", () => {
    const elf = syntheticCard({ name: 'Llanowar Elf', set: 'syn', collector_number: '1' })
    const scratch = createTestDb()
    insertCardRows(scratch, 'cards', [scryfallToRow(elf)!])
    rebuildCardNames(scratch)
    const d = decide(reading({ title: 'Llanowar Elfs' }), createCardLookups(scratch))
    expect(d.outcome).toBe('unsure')
    expect(d.candidates.map((c) => c.card.name).sort()).toEqual(['Llanowar Elf', 'Llanowar Elves'])
    expect(decide(reading({ title: 'Xqzv Plorp' }), lookups)).toMatchObject({ outcome: 'unsure', card: null, candidates: [] })
    expect(decide(reading({}), lookups)).toMatchObject({ outcome: 'unsure', card: null })
  })

  it('prefers an exact name even when a longer name is nearly as close', () => {
    const scratch = createTestDb()
    insertCardRows(scratch, 'cards', [scryfallToRow(syntheticCard({ name: 'Island Sanctuary', set: 'syn', collector_number: '2' }))!])
    rebuildCardNames(scratch)
    expect(decide(reading({ title: 'Island', setCode: 'm21' }), createCardLookups(scratch)).outcome).toBe('confident')
  })

  it("isn't confident when a misread number lands on a neighbor with a similar name", () => {
    const syn = lookupsWith(
      { name: 'Goblin Rabblemaster', set: 'syn', collector_number: '145' },
      { name: 'Goblin Roughrider', set: 'syn', collector_number: '146' },
    )
    const d = decide(reading({ title: 'Goblin Rabblemaster', setCode: 'syn', collectorNumber: '146' }), syn)
    expect([d.outcome, d.card?.name, d.card?.collectorNumber]).toEqual(['printing', 'Goblin Rabblemaster', '145'])
  })

  it("doesn't let a keyword line confirm a card whose name is only close to it", () => {
    const syn = lookupsWith({ name: 'Fling', set: 'syn', collector_number: '50' })
    const d = decide(reading({ texts: ['Flying', 'Creature — Dragon'], setCode: 'syn', collectorNumber: '50' }), syn)
    expect(d).toMatchObject({ outcome: 'unsure', card: null })
  })

  it('is unsure of the printing when the set, number, or year read rules out every printing left', () => {
    // m11 #146 is another card, so the set or the number was misread: M11's Lightning Bolt is #149, M10's is #146.
    const m11 = lookupsWith({ name: 'Filler Card', set: 'm11', collector_number: '146' })
    const d = decide(reading({ title: 'Lightning Bolt', setCode: 'm11', collectorNumber: '146' }), m11)
    expect([d.outcome, d.card?.id]).toEqual(['printing', id('Lightning Bolt', 'm11')])
    // No Lightning Bolt was printed in 1997 or 1998.
    expect(outcome({ title: 'Lightning Bolt', year: 1997 })).toEqual(['printing', id('Lightning Bolt', 'm11')])
    expect(outcome({ title: 'Lightning Bolt', setCode: 'm10', year: 1997 })).toEqual(['printing', id('Lightning Bolt', 'm10')])
  })

  it('says when what was read contradicted the title, which a plain uncertain printing does not', () => {
    const m11 = lookupsWith({ name: 'Filler Card', set: 'm11', collector_number: '146' })
    expect(decide(reading({ title: 'Lightning Bolt', setCode: 'm11', collectorNumber: '146' }), m11)).toMatchObject({ outcome: 'printing', contradicted: true })
    expect(decide(reading({ title: 'Lightning Bolt', year: 1997 }), lookups)).toMatchObject({ outcome: 'printing', contradicted: true })
    // Several printings, and nothing read rules any of them out.
    expect(decide(reading({ title: 'Lightning Bolt' }), lookups)).toMatchObject({ outcome: 'printing', contradicted: false })
    expect(decide(reading({ title: 'Lightning Bolt', year: 2009 }), lookups)).toMatchObject({ outcome: 'printing', contradicted: false })
    // The other outcomes never say so.
    expect(decide(reading({ title: 'Lightning Bolt', setCode: 'm11', collectorNumber: '149' }), lookups).contradicted).toBe(false)
    expect(decide(reading({ title: 'Tarmogoyf' }), lookups).contradicted).toBe(false)
    expect(decide(reading({ title: 'Xqzv Plorp' }), lookups).contradicted).toBe(false)
  })

  it("doesn't accept a multi-face card on one face name alone: its sideways names need two lines", () => {
    // dmr #215 is Fire // Ice. "Fire" alone could be any line of rules text, and there's no title to go on.
    expect(decide(reading({ texts: ['Fire', 'Instant'], setCode: 'dmr', collectorNumber: '215' }), lookups)).toMatchObject({ outcome: 'unsure', card: null })
  })

  it("accepts a set-and-number hit whose full name is printed on a line of its own, even with no title", () => {
    // A flavor-name card: the title bar holds the flavor name, and the card's real name is printed small below it.
    const d = decide(reading({ texts: ['Tempest of Sparks', 'Lightning Bolt', 'Instant'], setCode: 'm11', collectorNumber: '149' }), lookups)
    expect([d.outcome, d.card?.id]).toEqual(['confident', id('Lightning Bolt', 'm11')])
  })

  it('leaves it to the title when the set and numbers read name two printings the card vouches for', () => {
    // A card printed twice in one set (a regular and a showcase printing), and a stray number that names the other one.
    const syn = lookupsWith(
      { name: 'Goblin Rabblemaster', set: 'syn', collector_number: '145', oracle_id: '11111111-0000-4000-8000-00000000rabb' },
      { name: 'Goblin Rabblemaster', set: 'syn', collector_number: '290', oracle_id: '11111111-0000-4000-8000-00000000rabb' },
    )
    const d = decide(reading({ title: 'Goblin Rabblemaster', setCode: 'syn', collectorNumber: '290', collectorNumbers: ['290', '145'] }), syn)
    expect(d.outcome).toBe('printing')
  })

  it('tries every collector number read against the set code, for a card only its printed name vouches for', () => {
    // No title to name the card, so only the set code and number can: the stray "2" names nothing, #149 does.
    const d = decide(reading({ texts: ['2', 'Lightning Bolt', 'Instant'], setCode: 'm11', collectorNumber: '2', collectorNumbers: ['2', '149'] }), lookups)
    expect([d.outcome, d.card?.id]).toEqual(['confident', id('Lightning Bolt', 'm11')])
  })

  it('is unsure of the card when namesakes share its name, until the set and number pick one', () => {
    const ust = lookupsWith(
      { name: 'Everythingamajig', set: 'ust', collector_number: '147a' },
      { name: 'Everythingamajig', set: 'ust', collector_number: '147b' },
    )
    const alone = decide(reading({ title: 'Everythingamajig' }), ust)
    expect(alone.outcome).toBe('unsure')
    const namesakes = alone.candidates.filter((c) => c.card.name === 'Everythingamajig')
    expect(namesakes.map((c) => c.card.collectorNumber).sort()).toEqual(['147a', '147b'])
    const picked = decide(reading({ title: 'Everythingamajig', setCode: 'ust', collectorNumber: '147b' }), ust)
    expect([picked.outcome, picked.card?.collectorNumber]).toEqual(['confident', '147b'])
  })

  it('is unsure of the printing of a card with no English printing', () => {
    const italian = lookupsWith({ name: 'Ricordo Lontano', set: 'syn', collector_number: '3', lang: 'it' })
    const d = decide(reading({ title: 'Ricordo Lontano' }), italian)
    expect([d.outcome, d.card?.lang]).toEqual(['printing', 'it'])
  })

  it('counts every collector number read, so a stray number line neither wins nor contradicts', () => {
    // A loyalty cost that lost its minus sign, "2", sits in the collector band above the real number.
    const read = readCard(
      ocr(line('Ugin, Eye of the Storms', 0.06), line('2', 0.9, 0.08, 0.02), line('0213', 0.936, 0.07, 0.012), line('TDM • EN', 0.951, 0.07, 0.014)),
    )
    expect(read).toMatchObject({ setCode: 'tdm', collectorNumber: '2', collectorNumbers: ['2', '213'] })
    // The fixture's Tarmogoyf is fra #116.
    const d = reading({ title: 'Tarmogoyf', setCode: 'fra', collectorNumber: '2', collectorNumbers: ['2', '116'] })
    expect(decide(d, lookups)).toMatchObject({ outcome: 'confident', card: { id: id('Tarmogoyf', 'fra') } })
    // With no set code read, only the printings' numbers count: "2" alone would contradict the title.
    const noSet = reading({ title: 'Tarmogoyf', collectorNumber: '2', collectorNumbers: ['2', '116'] })
    expect(decide(noSet, lookups)).toMatchObject({ outcome: 'confident', card: { id: id('Tarmogoyf', 'fra') } })
  })
})
