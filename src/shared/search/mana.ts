const SYMBOL = /\{([^{}]+)\}|(\d+)|([WUBRGCXYZS])/giy
/**
 * What a braced symbol can hold: a number, a color or other mana letter, a hybrid (`W/U`, `2/W`, `C/W`), a Phyrexian
 * symbol (`W/P`, `G/U/P`), half mana (`½`, `HW`), or `∞`.
 */
const BRACED = /^(?:\d+|[WUBRGCXYZS]|[WUBRGC2]\/[WUBRGP](?:\/P)?|½|∞|H[WR])$/i

/**
 * Reads a mana cost written with braces (`{2}{W}{W}`, `{W/U}`) or as shorthand (`2WW`, `XRR`) into canonical symbols
 * such as `{2}`, `{W}`, `{W/U}`. Returns null when the text isn't a mana cost.
 */
export function parseManaSymbols(value: string): string[] | null {
  const text = value.trim()
  if (text === '') return null
  const symbols: string[] = []
  SYMBOL.lastIndex = 0
  while (SYMBOL.lastIndex < text.length) {
    const match = SYMBOL.exec(text)
    if (!match) return null
    const [, braced, digits, letter] = match
    if (braced !== undefined && !BRACED.test(braced)) return null
    symbols.push(`{${(braced ?? digits ?? letter ?? '').toUpperCase()}}`)
  }
  return symbols
}
