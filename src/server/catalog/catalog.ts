import type { DB } from '../db/index.ts'

export interface SetInfo {
  code: string
  name: string
  releasedAt: string
}

export interface TypeCatalog {
  supertypes: string[]
  types: string[]
  subtypes: string[]
}

/** Every set in the local card data, newest first. */
export function listSets(db: DB): SetInfo[] {
  return db
    .prepare(
      `SELECT set_code AS code, set_name AS name, MIN(released_at) AS releasedAt
       FROM cards GROUP BY set_code ORDER BY releasedAt DESC, name`,
    )
    .all() as SetInfo[]
}

const SUPERTYPES = new Set(['Basic', 'Elite', 'Legendary', 'Ongoing', 'Snow', 'World'])
const WORD = /^[A-Z][A-Za-z'-]*$/
/** Subtypes of more than one word (Scryfall's catalogs have these): a type line doesn't mark where they end. */
const MULTI_WORD_SUBTYPES = ['Time Lord']

/** The words used in type lines, split into supertypes, card types, and subtypes (for type autocomplete). */
export function listTypes(db: DB): TypeCatalog {
  const supertypes = new Set<string>()
  const types = new Set<string>()
  const subtypes = new Set<string>()
  const lines = db.prepare('SELECT DISTINCT type_line FROM cards').pluck().all() as string[]
  for (const line of lines) {
    for (const face of line.split(' // ')) {
      const [left = '', right = ''] = face.split(' — ')
      for (const word of left.split(' ')) {
        if (!WORD.test(word)) continue
        if (SUPERTYPES.has(word)) supertypes.add(word)
        else types.add(word)
      }
      let rest = right
      for (const subtype of MULTI_WORD_SUBTYPES) {
        const whole = new RegExp(`(^| )${subtype}( |$)`)
        if (!whole.test(rest)) continue
        subtypes.add(subtype)
        rest = rest.replace(whole, ' ')
      }
      for (const word of rest.split(' ')) if (WORD.test(word)) subtypes.add(word)
    }
  }
  const sorted = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b))
  return { supertypes: sorted(supertypes), types: sorted(types), subtypes: sorted(subtypes) }
}
