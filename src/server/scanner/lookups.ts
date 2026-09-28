import { createFuzzySearch, type FuzzySearch } from '../cards/fuzzy.ts'
import { cardNameIndex, type CardNameIndex } from '../cards/names.ts'
import { DEFAULT_PRINTING_ORDER } from '../cards/repo.ts'
import type { DB } from '../db/index.ts'
import { getMeta } from '../db/meta.ts'
import type { CardLookups, CardRef } from './matcher.ts'

interface RefRow {
  id: string
  oracle_id: string
  name: string
  face_names: string
  set_code: string
  collector_number: string
  released_at: string
  lang: string
}

const toRef = (r: RefRow): CardRef => ({
  id: r.id,
  oracleId: r.oracle_id,
  name: r.name,
  faceNames: r.face_names.split('\n'),
  setCode: r.set_code,
  collectorNumber: r.collector_number,
  releasedAt: r.released_at,
  lang: r.lang,
})

const REF_COLUMNS = 'id, oracle_id, name, face_names, set_code, collector_number, released_at, lang'

/**
 * The matcher's card data from SQLite. The name index, set codes, and namesakes are loaded on first use (about 70 ms)
 * and again when the card data changes.
 */
export function createCardLookups(db: DB): CardLookups {
  const bySetAndNumber = db.prepare(`SELECT ${REF_COLUMNS} FROM cards WHERE set_code = ? AND collector_number = ?`)
  const printings = db.prepare(
    `SELECT ${REF_COLUMNS} FROM cards WHERE oracle_id = ? ORDER BY ${DEFAULT_PRINTING_ORDER}`,
  )
  const setCodes = db.prepare('SELECT DISTINCT set_code FROM cards').pluck()
  // Card identities that share one full name, ignoring letter case, one group per name.
  const namesakeGroups = db
    .prepare(
      `SELECT group_concat(oracle_id, char(10) ORDER BY oracle_id) FROM card_names
       GROUP BY lower(name) HAVING count(*) > 1`,
    )
    .pluck()
  let cached: {
    version: string
    index: CardNameIndex
    search: FuzzySearch
    sets: string[]
    namesakes: Map<string, string[]>
  } | null = null
  const current = () => {
    const version = `${getMeta(db, 'bulk_updated_at')}|${getMeta(db, 'card_names_version')}`
    if (cached?.version !== version) {
      const index = cardNameIndex(db)
      const namesakes = new Map<string, string[]>()
      for (const group of namesakeGroups.all() as string[]) {
        const ids = group.split('\n')
        for (const id of ids) namesakes.set(id, ids.filter((other) => other !== id))
      }
      cached = { version, index, search: createFuzzySearch(index.keys), sets: setCodes.all() as string[], namesakes }
    }
    return cached
  }
  return {
    bySetAndNumber: (setCode, collectorNumber) => (bySetAndNumber.all(setCode, collectorNumber) as RefRow[]).map(toRef),
    setCodes: () => current().sets,
    findName: (name) => current().index.find(name)?.oracleId ?? null,
    searchNames: (normalized, threshold) => current().search(normalized, threshold),
    printings: (oracleId) => (printings.all(oracleId) as RefRow[]).map(toRef),
    namesakes: (oracleId) => current().namesakes.get(oracleId) ?? [],
  }
}
