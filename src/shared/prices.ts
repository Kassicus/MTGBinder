import type { Finish, Prices } from './types.ts'

const FINISH_ORDER: readonly Finish[] = ['nonfoil', 'foil', 'etched']

/** What one copy in this finish is worth: foil copies use the foil price, etched the etched price. */
export function finishPrice(prices: Prices, finish: Finish): number | null {
  return finish === 'foil' ? prices.usdFoil : finish === 'etched' ? prices.usdEtched : prices.usd
}

/** The price to list for a printing: its first finish (nonfoil, foil, etched) that has one, or null if none do. */
export function listPrice(prices: Prices, finishes: readonly Finish[]): { finish: Finish; usd: number } | null {
  for (const finish of FINISH_ORDER) {
    const usd = finishes.includes(finish) ? finishPrice(prices, finish) : null
    if (usd !== null) return { finish, usd }
  }
  return null
}
