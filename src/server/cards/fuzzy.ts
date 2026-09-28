import { jaroWinkler } from '../../shared/similarity.ts'
import type { CardNameIndex } from './names.ts'

export interface FuzzyHit {
  oracleId: string
  score: number
}

/** Card identities scoring at least `threshold` against a normalized name, best first. */
export type FuzzySearch = (query: string, threshold: number) => FuzzyHit[]

/** Symbols a normalized name uses: a–z, 0–9, and the space. */
const SYMBOLS = 37

/** A character's symbol slot. Anything but a–z and 0–9 shares the space's slot, which can only raise a shared count. */
function slot(code: number): number {
  if (code >= 97 && code <= 122) return code - 97 // a–z → 0–25
  if (code >= 48 && code <= 57) return code - 22 // 0–9 → 26–35
  return 36
}

/**
 * Searches every name for those scoring at least a threshold, for decklist import (spec §5.4.2) and scan matching
 * (§5.1.2). A cheap upper bound on each name's score skips most names unscored, and it never skips one that could
 * reach the threshold:
 * - With l the common prefix (at most 4), Jaro–Winkler is jaro + 0.1·l·(1 − jaro), which rises with jaro, so it
 *   reaches the threshold only when jaro ≥ need = (threshold − 0.1·l) / (1 − 0.1·l).
 * - jaro = (m/|q| + m/|k| + (m − t/2)/m) / 3 ≤ (m/|q| + m/|k| + 1) / 3, as transpositions t ≥ 0; and the matches m
 *   can't exceed the shorter length, nor the symbols the two names share (Σ of the smaller count of each symbol).
 * So a name is skipped when m < (3·need − 1) / (1/|q| + 1/|k|) for m = the shorter length, or for m = the shared
 * symbols. The shared count is |q| less the query's symbols the name lacks, summed rarest symbol first and cut short
 * once too many are missing.
 *
 * Counts every name's symbols once and returns the search for one normalized name: each card identity scoring at
 * least `threshold` (by its best name), best first; equal scores keep the order of the names in the index.
 */
export function createFuzzySearch(keys: CardNameIndex['keys']): FuzzySearch {
  const counts = new Uint16Array(keys.length * SYMBOLS)
  const frequency = new Float64Array(SYMBOLS)
  keys.forEach(({ key }, i) => {
    for (let c = 0; c < key.length; c++) {
      const s = slot(key.charCodeAt(c))
      counts[i * SYMBOLS + s]!++
      frequency[s]!++
    }
  })
  return (query, threshold) => {
    // The jaro each prefix length 0–4 needs, less a hair so float rounding can't skip a name scoring exactly the
    // threshold.
    const needs = [0, 1, 2, 3, 4].map((l) => (threshold - 0.1 * l) / (1 - 0.1 * l) - 1e-9)
    const queryCounts = new Uint16Array(SYMBOLS)
    for (let c = 0; c < query.length; c++) queryCounts[slot(query.charCodeAt(c))]!++
    const used: number[] = []
    for (let s = 0; s < SYMBOLS; s++) if (queryCounts[s]! > 0) used.push(s)
    used.sort((a, b) => frequency[a]! - frequency[b]!)
    const best = new Map<string, { score: number; at: number }>()
    for (let i = 0; i < keys.length; i++) {
      const { key, oracleId } = keys[i]!
      const prefixMax = Math.min(4, query.length, key.length)
      let l = 0
      while (l < prefixMax && query.charCodeAt(l) === key.charCodeAt(l)) l++
      const minShared = (3 * needs[l]! - 1) / (1 / query.length + 1 / key.length)
      if (Math.min(query.length, key.length) < minShared) continue
      const allowedMissing = query.length - minShared
      let missing = 0
      for (const s of used) {
        const lacking = queryCounts[s]! - counts[i * SYMBOLS + s]!
        if (lacking > 0 && (missing += lacking) > allowedMissing) break
      }
      if (missing > allowedMissing) continue
      const score = jaroWinkler(query, key)
      const known = best.get(oracleId)
      if (score >= threshold && (known === undefined || score > known.score)) best.set(oracleId, { score, at: i })
    }
    return [...best]
      .sort(([, a], [, b]) => b.score - a.score || a.at - b.at)
      .map(([oracleId, { score }]) => ({ oracleId, score }))
  }
}
