/**
 * Canonical form of a card name for matching: lowercase ASCII letters and digits separated by single spaces.
 * Folds ligatures (Æ → ae) and accents (û → u), drops apostrophes, and turns other punctuation into spaces.
 */
export function normalizeName(name: string): string {
  return name
    .replace(/[Ææ]/g, 'ae')
    .replace(/[Œœ]/g, 'oe')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’‘`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
