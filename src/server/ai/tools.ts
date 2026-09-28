import type Anthropic from '@anthropic-ai/sdk'
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { FORMAT_IDS, FORMATS } from '../../shared/formats.ts'
import { normalizeName } from '../../shared/normalize.ts'
import type { Board, CreatedDeck, DeckImportItem, FormatId, Ownership, SearchCard } from '../../shared/types.ts'
import { createFuzzySearch } from '../cards/fuzzy.ts'
import { cardNameIndex, type CardNameIndex } from '../cards/names.ts'
import { getCard } from '../cards/repo.ts'
import type { DB } from '../db/index.ts'
import { deckDetail } from '../decks/analysis.ts'
import { FUZZY_THRESHOLD } from '../decks/import.ts'
import { createDeck, getDeckRow, importIntoDeck, listDeckRows } from '../decks/repo.ts'
import { getOwnership } from '../ownership/repo.ts'
import { ScryfallError, type ScryfallClient } from '../scryfall/client.ts'
import { SearchQueryError } from '../search/compile.ts'
import { LOCAL_PAGE_SIZE, searchLibrary } from '../search/run.ts'
import { searchScryfall } from '../search/scryfall.ts'

/** Results a search returns unless Claude asks for another number. */
const DEFAULT_LIMIT = 25
/** Most distinct cards Claude may put in one new deck. */
export const MAX_DECK_CARDS = 250
/** How close a name must be for get_card to suggest it when nothing matches. */
const SUGGEST_THRESHOLD = 0.8
/** Most input problems a refused call reports (one bad call can have hundreds). */
const MAX_INPUT_PROBLEMS = 5
/** Most card warnings a new deck's result lists. */
const MAX_CARD_WARNINGS = 10
/** Most decks get_deck lists when no deck has the name it was given. */
const MAX_LISTED_DECKS = 20

export interface ToolOutcome {
  /** The tool result Claude reads (JSON). */
  content: string
  /** Set when the call created a deck, for the "Open in deckbuilder" button. */
  deck: CreatedDeck | null
}

export interface BrainstormTools {
  /** Tool definitions for the API, always in the same order so the prompt cache holds. */
  definitions: Anthropic.Beta.BetaToolUnion[]
  /** Validates a call's input and runs it. Throws with a message Claude can act on when the input or the call fails. */
  run(name: string, input: unknown): Promise<ToolOutcome>
  /** The activity line the chat shows for a call: "Searching your library for `t:elf`". */
  describe(name: string, input: unknown): string
}

const money = (usd: number | null) => (usd === null ? null : Math.round(usd * 100) / 100)

/** The first `max` items, then "…and N more" for the rest. */
function upTo(items: string[], max: number): string[] {
  return items.length > max ? [...items.slice(0, max), `…and ${items.length - max} more`] : items
}

function stake(ownership: Ownership) {
  return {
    owned: ownership.owned,
    free: ownership.free,
    decks: ownership.decks.map((d) => `${d.name} (deck ${d.id}, ${d.status}, ${d.quantity}${d.maybe > 0 ? `, ${d.maybe} on maybe` : ''})`),
  }
}

function compact(card: SearchCard) {
  return {
    name: card.name,
    mana_cost: card.manaCost,
    type: card.typeLine,
    ...(card.power !== null ? { pt: `${card.power}/${card.toughness ?? '?'}` } : {}),
    ...(card.loyalty !== null ? { loyalty: card.loyalty } : {}),
    price_usd: money(card.priceUsd),
    ...stake(card.ownership),
  }
}

const Query = z.string().trim().min(1).max(500)
const Limit = z.number().int().min(1).max(LOCAL_PAGE_SIZE)
const BoardSchema = z.enum(['commander', 'main', 'side', 'maybe'])

const SearchInput = z.object({
  query: Query.describe('A search in Scryfall syntax, e.g. `t:elf id:g mv<=3` or `o:"draw a card" f:commander`.'),
  limit: Limit.optional().describe(`Most cards to return (default ${DEFAULT_LIMIT}).`),
})
const CardInput = z.object({ name: z.string().trim().min(1).max(200).describe("The card's name, as printed.") })
const EXACTLY_ONE_DECK = 'Give exactly one of deck_id or name.'
const DeckInput = z
  .object({
    deck_id: z
      .number()
      .int()
      .min(1)
      .describe('The deck id Binder gave the deck, as in "Elves (deck 3, built, 1)" in a card\'s decks list.')
      .optional(),
    name: z.string().trim().min(1).max(100).describe("The deck's name, in any letter case.").optional(),
  })
  .refine((input) => (input.deck_id === undefined) !== (input.name === undefined), { message: EXACTLY_ONE_DECK })
  .describe(EXACTLY_ONE_DECK)
const CreateInput = z.object({
  name: z.string().trim().min(1).max(100).describe("The deck's name."),
  format: z.enum(FORMAT_IDS as [FormatId, ...FormatId[]]),
  notes: z.string().max(5000).optional().describe('The plan for the deck, in a few sentences: its strategy and key cards.'),
  cards: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        quantity: z.number().int().min(1).max(99),
        board: BoardSchema.optional().describe('Defaults to main. Commanders go on the commander board.'),
        category: z.string().trim().max(60).optional().describe('A role such as "Ramp" or "Removal".'),
      }),
    )
    .min(1)
    .max(MAX_DECK_CARDS),
})

/** Why a Scryfall search failed, in words Claude can act on. */
function scryfallProblem(err: unknown): string {
  if (err instanceof ScryfallError) {
    if (err.code === 'offline') return "Scryfall can't be reached right now; search the library instead"
    if (err.code === 'rate_limited') return 'Scryfall is rate-limiting searches; wait before searching it again'
    if (err.code === 'http' && err.status !== null && err.status >= 500) return 'Scryfall had a problem; try again later, or search the library'
    // A 400 "All of your terms were ignored." says which terms, and why, only in its warnings.
    if (err.warnings.length > 0) return `${err.message} ${err.warnings.join(' ')}`
  }
  return err instanceof Error ? err.message : String(err)
}

/** A refused call's problems, readably and at most MAX_INPUT_PROBLEMS of them (zod's own message is a JSON dump). */
function inputProblems(err: z.ZodError): string {
  const shown = z.prettifyError(new z.ZodError(err.issues.slice(0, MAX_INPUT_PROBLEMS)))
  const more = err.issues.length - MAX_INPUT_PROBLEMS
  return more > 0 ? `${shown}\n…and ${more} more` : shown
}

/** Brainstorm's tools (spec §5.5), over the owner's library, the card data, Scryfall, and the decks. */
export function createBrainstormTools(deps: { db: DB; scryfall: ScryfallClient }): BrainstormTools {
  const { db, scryfall } = deps

  /**
   * Resolves a written card name the way decklist import does: exact, then a face, then a close fuzzy match. `fuzzy`
   * says the name only resembles the card's, so Claude can tell the owner what it became.
   */
  function resolver() {
    const index: CardNameIndex = cardNameIndex(db)
    let fuzzy: ReturnType<typeof createFuzzySearch> | undefined
    return {
      index,
      find(name: string): { oracleId: string; fuzzy: boolean } | null {
        const hit = index.find(name)
        if (hit) return { oracleId: hit.oracleId, fuzzy: false }
        const key = normalizeName(name)
        if (key === '') return null
        fuzzy ??= createFuzzySearch(index.keys)
        const close = fuzzy(key, FUZZY_THRESHOLD)[0]
        return close ? { oracleId: close.oracleId, fuzzy: true } : null
      },
      suggest(name: string): string[] {
        fuzzy ??= createFuzzySearch(index.keys)
        const names = fuzzy(normalizeName(name), SUGGEST_THRESHOLD).map((h) => index.name(h.oracleId) ?? '')
        return [...new Set(names.filter(Boolean))].slice(0, 3)
      },
    }
  }

  /**
   * The id of the one deck with this name (any letter case). Throws when several have it, listing them, or when none
   * does, listing the owner's decks (by name, MAX_LISTED_DECKS at most).
   */
  function deckIdNamed(name: string): number {
    const decks = listDeckRows(db)
    const label = (d: (typeof decks)[number]) => `${d.name} (deck ${d.id}, ${d.status})`
    const wanted = name.trim().toLowerCase()
    const matches = decks.filter((d) => d.name.trim().toLowerCase() === wanted)
    if (matches.length === 1) return matches[0]!.id
    if (matches.length > 1) {
      throw new Error(`Several decks are named "${name}": ${matches.map(label).join(', ')}. Call get_deck with the deck_id of the one you mean.`)
    }
    if (decks.length === 0) throw new Error(`There is no deck named "${name}". The owner has no decks yet.`)
    throw new Error(`There is no deck named "${name}". The owner's decks: ${upTo(decks.map(label), MAX_LISTED_DECKS).join(', ')}.`)
  }

  const tools = [
    betaZodTool({
      name: 'search_my_library',
      description:
        "Searches the cards the owner owns (their collection), in Scryfall syntax. Call this whenever a suggestion depends on what they own: before recommending a card as 'already owned', and to find owned cards that fit a plan. Library-only filters: `free>0` (copies not in built decks), `qty>=2` (copies owned), `is:foil`, and `in:built`, `in:prospective`, or `in:\"Deck name\"` (cards in those decks). Each result has owned (copies), free (not in built decks), and the decks using it, each with its deck id. Results come sorted by name; when total is more than the cards shown, narrow the query rather than relying on the first page.",
      inputSchema: SearchInput,
      run: ({ query, limit = DEFAULT_LIMIT }) => {
        try {
          const page = searchLibrary(db, { q: query, sort: 'name', dir: 'asc', page: 1, view: 'cards' })
          return JSON.stringify({ total: page.total, cards: page.cards.slice(0, limit).map(compact) })
        } catch (err) {
          if (err instanceof SearchQueryError) throw new Error(`That query isn't valid: ${err.message}`)
          throw err
        }
      },
    }),
    betaZodTool({
      name: 'search_scryfall',
      description:
        "Searches every Magic card on Scryfall, in Scryfall syntax, most-played first (EDHREC rank). Call this to find cards the owner doesn't own yet, e.g. upgrades or missing pieces. Each result shows how many copies the owner has, so owned cards stand out.",
      inputSchema: SearchInput,
      run: async ({ query, limit = DEFAULT_LIMIT }) => {
        try {
          const page = await searchScryfall(db, scryfall, { q: query, sort: 'name', order: 'edhrec', dir: 'asc', page: 1 })
          return JSON.stringify({
            total: page.total,
            ...(page.warnings.length > 0 ? { warnings: page.warnings } : {}),
            cards: page.cards.slice(0, limit).map(compact),
          })
        } catch (err) {
          throw new Error(scryfallProblem(err))
        }
      },
    }),
    betaZodTool({
      name: 'get_card',
      description:
        "Gets one card's full Oracle text, types, legality in each format, price, and the owner's copies and decks. Call this before relying on a card's exact wording or legality.",
      inputSchema: CardInput,
      run: ({ name }) => {
        const names = resolver()
        const oracleId = names.find(name)?.oracleId
        if (!oracleId) {
          const close = names.suggest(name)
          throw new Error(`No card is named "${name}".${close.length > 0 ? ` Did you mean: ${close.join(', ')}?` : ''}`)
        }
        const defaultId = db.prepare('SELECT default_card_id FROM card_names WHERE oracle_id = ?').pluck().get(oracleId) as string
        const card = getCard(db, defaultId)!
        const ownership = getOwnership(db, [oracleId]).get(oracleId)!
        const legal = Object.values(FORMATS).flatMap((f) => (f.legality ? [[f.id, card.legalities[f.legality] ?? 'not_legal'] as const] : []))
        return JSON.stringify({
          name: card.name,
          mana_cost: card.manaCost,
          mana_value: card.cmc,
          type: card.typeLine,
          oracle_text: card.oracleText,
          ...(card.faces.length > 0
            ? { faces: card.faces.map((f) => ({ name: f.name, mana_cost: f.manaCost, type: f.typeLine, oracle_text: f.oracleText })) }
            : {}),
          ...(card.power !== null ? { pt: `${card.power}/${card.toughness ?? '?'}` } : {}),
          ...(card.loyalty !== null ? { loyalty: card.loyalty } : {}),
          color_identity: card.colorIdentity,
          legal_in: legal.filter(([, l]) => l === 'legal' || l === 'restricted').map(([id, l]) => (l === 'restricted' ? `${id} (restricted)` : id)),
          price_usd: money(card.prices.usd),
          ...stake(ownership),
        })
      },
    }),
    betaZodTool({
      name: 'get_deck',
      description:
        "Gets one of the owner's decks: its format, status (built or prospective), notes, every card with its board and category, and whether each card is owned, held by another built deck, or needs buying. Call this when the owner asks about a deck, and before suggesting changes to it. Give exactly one of deck_id or name. Deck ids appear in the decks list of each card that search_my_library, search_scryfall, and get_card return, as in \"Elves (deck 3, built, 1)\"; a deck's name works too, in any letter case.",
      inputSchema: DeckInput,
      run: ({ deck_id, name }) => {
        const id = deck_id ?? deckIdNamed(name!)
        const deck = deckDetail(db, id)
        if (!deck) throw new Error(`There is no deck ${id}.`)
        return JSON.stringify({
          id: deck.id,
          name: deck.name,
          format: deck.format,
          status: deck.status,
          notes: deck.notes,
          boards: deck.boards,
          completion_percent: Math.floor(deck.completion * 100),
          cost_to_finish_usd: money(deck.costToFinish),
          color_identity: deck.colorIdentity,
          warnings: deck.warnings,
          cards: deck.lines.map((l) => ({
            name: l.name,
            quantity: l.quantity,
            board: l.board,
            ...(l.category ? { category: l.category } : {}),
            status: l.status,
            ...(l.short > 0 ? { short: l.short } : {}),
            ...(l.warnings.length > 0 ? { warnings: l.warnings } : {}),
          })),
        })
      },
    }),
    betaZodTool({
      name: 'create_prospective_deck',
      description:
        "Saves a deck idea to the owner's deckbuilder as a prospective deck (it claims none of their cards). Call this only when the owner asks to save the deck. Names are matched like a pasted decklist: names that match no card are left out and listed in the result's unresolved, and names that only resemble a card's are swapped for that card and listed in its approximate (\"written → card\"), so tell the owner about both. Answers with the deck's id, how much of it the owner already has, the cost to finish it, and any warnings about the deck or its cards.",
      inputSchema: CreateInput,
      run: ({ name, format, notes, cards }) => {
        const names = resolver()
        const items: DeckImportItem[] = []
        const unresolved: string[] = []
        const approximate: string[] = []
        for (const card of cards) {
          const hit = names.find(card.name)
          if (!hit) {
            unresolved.push(card.name)
            continue
          }
          if (hit.fuzzy) approximate.push(`${card.name} → ${names.index.name(hit.oracleId) ?? '?'}`)
          items.push({ oracleId: hit.oracleId, cardId: null, quantity: card.quantity, board: (card.board ?? 'main') as Board, category: card.category || null })
        }
        if (items.length === 0) throw new Error(`None of the card names matched a card, so no deck was made: ${unresolved.join(', ')}`)
        const id = db.transaction(() => {
          const deckId = createDeck(db, { name, format, status: 'prospective', notes: notes ?? '' })
          importIntoDeck(db, deckId, items, false)
          return deckId
        })()
        const deck = deckDetail(db, id)!
        const cardWarnings = upTo(
          deck.lines.flatMap((l) => l.warnings.map((w) => `${l.name}: ${w}`)),
          MAX_CARD_WARNINGS,
        )
        return JSON.stringify({
          deck_id: id,
          name: deck.name,
          format: deck.format,
          cards: deck.cardCount,
          completion_percent: Math.floor(deck.completion * 100),
          cost_to_finish_usd: money(deck.costToFinish),
          ...(deck.unpricedToBuy > 0 ? { unpriced_to_buy: deck.unpricedToBuy } : {}),
          ...(unresolved.length > 0 ? { unresolved } : {}),
          ...(approximate.length > 0 ? { approximate } : {}),
          ...(deck.warnings.length > 0 ? { warnings: deck.warnings } : {}),
          ...(cardWarnings.length > 0 ? { card_warnings: cardWarnings } : {}),
        })
      },
    }),
  ]
  const byName = new Map(tools.map((t) => [t.name, t]))

  return {
    // betaZodTool makes custom tools; streamed tool inputs arrive as Claude writes them (validated here before running).
    definitions: tools.map((tool) => {
      const { name, description, input_schema } = tool as Anthropic.Beta.BetaTool
      return { name, description, input_schema, eager_input_streaming: true }
    }),
    async run(name, input) {
      const tool = byName.get(name)
      if (!tool) throw new Error(`There is no tool named ${name}.`)
      let parsed: unknown
      try {
        parsed = tool.parse(input)
      } catch (err) {
        if (err instanceof z.ZodError) throw new Error(inputProblems(err))
        throw err
      }
      const content = await tool.run(parsed as never)
      if (typeof content !== 'string') throw new Error('A tool answered with something other than text')
      return { content, deck: name === 'create_prospective_deck' ? createdDeckFrom(content) : null }
    },
    describe(name, input) {
      // The input hasn't been validated, and the chat builds this line outside its error handling, so never throw.
      const fallback = `Using ${name}`
      if (typeof input !== 'object' || input === null || Array.isArray(input)) return fallback
      const args = input as Record<string, unknown>
      const field = (key: string) => {
        const value = args[key]
        return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
      }
      try {
        switch (name) {
          case 'search_my_library':
            return `Searching your library for \`${field('query')}\``
          case 'search_scryfall':
            return `Searching Scryfall for \`${field('query')}\``
          case 'get_card':
            return `Looking up ${field('name')}`
          case 'get_deck': {
            if (field('deck_id') === '') return `Reading ${field('name')}`
            const deck = getDeckRow(db, Number(field('deck_id')))
            return `Reading ${deck ? deck.name : `deck ${field('deck_id')}`}`
          }
          case 'create_prospective_deck': {
            const cards = Array.isArray(args.cards) ? (args.cards as unknown[]) : []
            const count = cards.reduce((n: number, c) => n + (Number((c as { quantity?: unknown } | null)?.quantity) || 0), 0)
            return `Creating the deck “${field('name')}” (${count} ${count === 1 ? 'card' : 'cards'})`
          }
          default:
            return fallback
        }
      } catch {
        return fallback
      }
    },
  }
}

/** The deck a create_prospective_deck result describes, or null when the text isn't one. */
export function createdDeckFrom(content: string): CreatedDeck | null {
  try {
    const r = JSON.parse(content) as Record<string, unknown>
    if (typeof r.deck_id !== 'number' || typeof r.name !== 'string') return null
    return {
      id: r.deck_id,
      name: r.name,
      format: r.format as FormatId,
      cardCount: Number(r.cards) || 0,
      completion: (Number(r.completion_percent) || 0) / 100,
      costToFinish: Number(r.cost_to_finish_usd) || 0,
      unresolved: Array.isArray(r.unresolved) ? r.unresolved.map(String) : [],
    }
  } catch {
    return null
  }
}
