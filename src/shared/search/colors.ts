import { canonColors } from '../colors.ts'

/** A parsed color value: a set of colors in WUBRG order ('' = colorless), or "multicolor" (two or more colors). */
export type ColorValue = { kind: 'colors'; colors: string } | { kind: 'multicolor' }

const NAMED = new Map<string, string>([
  ['white', 'W'], ['blue', 'U'], ['black', 'B'], ['red', 'R'], ['green', 'G'],
  ['c', ''], ['colorless', ''],
  ['azorius', 'WU'], ['dimir', 'UB'], ['rakdos', 'BR'], ['gruul', 'RG'], ['selesnya', 'GW'],
  ['orzhov', 'WB'], ['izzet', 'UR'], ['golgari', 'BG'], ['boros', 'RW'], ['simic', 'GU'],
  ['bant', 'GWU'], ['esper', 'WUB'], ['grixis', 'UBR'], ['jund', 'BRG'], ['naya', 'RGW'],
  ['abzan', 'WBG'], ['jeskai', 'URW'], ['sultai', 'BGU'], ['mardu', 'RWB'], ['temur', 'GUR'],
])

/** Reads `wu`, `esper`, `blue`, `c`/`colorless`, or `m`/`multicolor`. Returns null when the value isn't a color. */
export function parseColorValue(value: string): ColorValue | null {
  const v = value.toLowerCase()
  if (v === 'm' || v === 'multicolor') return { kind: 'multicolor' }
  const named = NAMED.get(v)
  if (named !== undefined) return { kind: 'colors', colors: canonColors(named) }
  if (/^[wubrg]+$/.test(v)) return { kind: 'colors', colors: canonColors(v.toUpperCase()) }
  return null
}
