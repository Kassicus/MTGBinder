import type { SetCard, SetDetail, SetProgress } from '../../shared/types.ts'
import type { DB } from '../db/index.ts'

/**
 * Collector-number order: digit runs compare as numbers, so 2 comes before 10 (which text order reverses), 7 before 7a,
 * and The List's A25-99 before A25-101.
 */
const byNumber = new Intl.Collator('en', { numeric: true }).compare

/**
 * The sets with a copy owned, newest first, with how many of each set's cards are owned from it (spec §5.8). A card
 * counts once whichever of its printings in the set is owned, in any finish; a reprint owned from another set counts
 * for that set.
 */
export function listOwnedSets(db: DB): SetProgress[] {
  return db
    .prepare(
      `WITH owned AS (
         SELECT c.set_code, COUNT(DISTINCT c.oracle_id) AS owned
         FROM collection co CROSS JOIN cards c ON c.id = co.card_id
         GROUP BY c.set_code
       )
       SELECT o.set_code AS code, MAX(c.set_name) AS name, MAX(c.set_type) AS setType, MIN(c.released_at) AS releasedAt,
         o.owned AS owned, COUNT(DISTINCT c.oracle_id) AS total
       FROM owned o CROSS JOIN cards c ON c.set_code = o.set_code
       GROUP BY o.set_code
       ORDER BY releasedAt DESC, code`,
    )
    .all() as SetProgress[]
}

/**
 * A set and each of its cards once, at the card's lowest collector number in the set, in number order, with the copies
 * owned of the card's printings in the set (spec §5.8). The code matches in any case. Null when no printing has it.
 */
export function getSetDetail(db: DB, code: string): SetDetail | null {
  const setCode = code.toLowerCase()
  const set = db
    .prepare(
      `SELECT set_code AS code, MAX(set_name) AS name, MAX(set_type) AS setType, MIN(released_at) AS releasedAt
       FROM cards WHERE set_code = ? GROUP BY set_code`,
    )
    .get(setCode) as Omit<SetProgress, 'owned' | 'total'> | undefined
  if (!set) return null
  const printings = db
    .prepare(
      `SELECT c.id AS cardId, c.oracle_id AS oracleId, c.name AS name, c.collector_number AS collectorNumber,
         c.mana_cost AS manaCost, c.rarity AS rarity,
         COALESCE((SELECT SUM(co.quantity) FROM collection co WHERE co.card_id = c.id), 0) AS copies
       FROM cards c WHERE c.set_code = ?`,
    )
    .all(setCode) as SetCard[]
  printings.sort((a, b) => byNumber(a.collectorNumber, b.collectorNumber) || a.cardId.localeCompare(b.cardId))
  // Each card keeps its first printing in number order, and adds up the copies of all of them.
  const cards = new Map<string, SetCard>()
  for (const printing of printings) {
    const card = cards.get(printing.oracleId)
    if (card) card.copies += printing.copies
    else cards.set(printing.oracleId, printing)
  }
  const list = [...cards.values()]
  return { ...set, owned: list.filter((card) => card.copies > 0).length, total: list.length, cards: list }
}
