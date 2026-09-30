import { MODEL_VERSION, type CardData, type CardKind, type SeatSetup, type Setup, type SetupCard } from '../../src/shared/playtest/types.ts'

/** A card as a game carries it: one face, with a made-up image. */
export function cardData(name: string, kind: CardKind = 'creature', extra: Partial<CardData> = {}): CardData {
  const typeLine = { land: 'Land', creature: 'Creature — Goblin', other: 'Artifact', spell: 'Instant', emblem: 'Emblem — Goblin' }[kind]
  return {
    name,
    faces: [
      {
        name,
        manaCost: kind === 'land' ? '' : '{R}',
        typeLine,
        oracleText: '',
        power: kind === 'creature' ? '1' : null,
        toughness: kind === 'creature' ? '1' : null,
        loyalty: null,
        image: `https://img.example/${encodeURIComponent(name)}.jpg`,
      },
    ],
    imageSmall: `https://img.example/small/${encodeURIComponent(name)}.jpg`,
    colors: kind === 'land' ? '' : 'R',
    kind,
    ...extra,
  }
}

/** A double-faced card: each face has its own image. */
export function doubleFaced(front: string, back: string): CardData {
  const card = cardData(front)
  return { ...card, name: `${front} // ${back}`, faces: [card.faces[0]!, { ...card.faces[0]!, name: back, image: `https://img.example/${back}.jpg` }] }
}

/**
 * A seat's deck: `size` cards named "<prefix> 1", "<prefix> 2", … (every fifth a land), with ids `<seat>-1`, … and
 * then its commanders, if any.
 */
export function deck(seat: 1 | 2, size: number, options: { name?: string; commanders?: string[]; prefix?: string } = {}): SeatSetup {
  const prefix = options.prefix ?? `S${seat}`
  const cards: SetupCard[] = []
  for (let i = 1; i <= size; i++) {
    cards.push({ id: `${seat}-${i}`, commander: false, data: cardData(`${prefix} ${i}`, i % 5 === 0 ? 'land' : 'creature') })
  }
  for (const [i, name] of (options.commanders ?? []).entries()) {
    cards.push({ id: `${seat}-c${i + 1}`, commander: true, data: cardData(name) })
  }
  return { deckId: seat, name: options.name ?? `Seat ${seat} deck`, format: 'commander', cards, leftOut: 0 }
}

export function setup(overrides: Partial<Setup> = {}): Setup {
  return {
    version: MODEL_VERSION,
    seed: 42,
    seats: [deck(1, 40, { commanders: ['Krenko, Mob Boss'] }), deck(2, 40, { commanders: ['Meren of Clan Nel Toth'] })],
    startingSeat: 0,
    life: 40,
    startingDraws: false,
    ...overrides,
  }
}
