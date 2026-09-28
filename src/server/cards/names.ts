import { normalizeName } from '../../shared/normalize.ts'
import type { DB } from '../db/index.ts'
import { specialPrintingSql } from './repo.ts'

export interface NameHit {
  oracleId: string
  /** `exact`: the card's full name; `face`: one face of a multi-face card. */
  match: 'exact' | 'face'
}

export interface CardNameIndex {
  /**
   * The card a written name means: its exact full name (any letter case), then its full name ignoring punctuation and
   * accents, then a face name. Each step also tries the front half of an "A // B" name. Where two cards share a name
   * once punctuation is ignored ("Rampant Growth" and the joke card "Rampant, Growth"), a card from a regular set wins.
   */
  find(name: string): NameHit | null
  /** A card identity's display name. */
  name(oracleId: string): string | undefined
  /** Every normalized full and face name with its card, for fuzzy matching. */
  keys: ReadonlyArray<{ key: string; oracleId: string }>
}

/** Loads every card name once, for resolving many written names (CSV and decklist imports). */
export function cardNameIndex(db: DB): CardNameIndex {
  const rows = db
    .prepare(
      `SELECT n.oracle_id, n.name, n.search_name, n.face_names
       FROM card_names n JOIN cards c ON c.id = n.default_card_id
       ORDER BY ${specialPrintingSql('c.')} ASC, n.name`,
    )
    .all() as Array<{ oracle_id: string; name: string; search_name: string; face_names: string }>
  const exact = new Map<string, string>()
  const full = new Map<string, string>()
  const face = new Map<string, string>()
  const names = new Map<string, string>()
  const keys: Array<{ key: string; oracleId: string }> = []
  const first = (map: Map<string, string>, key: string, oracleId: string) => {
    if (map.has(key)) return false
    map.set(key, oracleId)
    return true
  }
  for (const r of rows) {
    names.set(r.oracle_id, r.name)
    first(exact, r.name.toLowerCase(), r.oracle_id)
    if (first(full, r.search_name, r.oracle_id)) keys.push({ key: r.search_name, oracleId: r.oracle_id })
  }
  for (const r of rows) {
    const faces = r.face_names.split('\n')
    if (faces.length < 2) continue
    for (const f of faces) {
      const key = normalizeName(f)
      if (!full.has(key) && first(face, key, r.oracle_id)) keys.push({ key, oracleId: r.oracle_id })
    }
  }
  return {
    find(name) {
      const variants = [name, ...(name.includes('//') ? [name.slice(0, name.indexOf('//'))] : [])].map((v) => v.trim())
      for (const v of variants) {
        const id = exact.get(v.toLowerCase()) ?? full.get(normalizeName(v))
        if (id) return { oracleId: id, match: 'exact' }
      }
      for (const v of variants) {
        const id = face.get(normalizeName(v))
        if (id) return { oracleId: id, match: 'face' }
      }
      return null
    },
    name: (oracleId) => names.get(oracleId),
    keys,
  }
}
