export const WUBRG = ['W', 'U', 'B', 'R', 'G'] as const

/** Color letters in canonical WUBRG order; '' means colorless. Accepts any iterable of letters (a string works). */
export function canonColors(colors: Iterable<string>): string {
  const present = new Set(colors)
  return WUBRG.filter((c) => present.has(c)).join('')
}
