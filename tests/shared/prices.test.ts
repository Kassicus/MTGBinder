import { describe, expect, it } from 'vitest'
import { finishPrice, listPrice } from '../../src/shared/prices.ts'

const prices = { usd: 1.5, usdFoil: 6, usdEtched: 4 }

describe('prices', () => {
  it('prices a copy by its finish', () => {
    expect([finishPrice(prices, 'nonfoil'), finishPrice(prices, 'foil'), finishPrice(prices, 'etched')]).toEqual([1.5, 6, 4])
  })

  it('lists the first finish the printing comes in that has a price', () => {
    expect(listPrice(prices, ['nonfoil', 'foil'])).toEqual({ finish: 'nonfoil', usd: 1.5 })
    expect(listPrice({ ...prices, usd: null }, ['nonfoil', 'foil'])).toEqual({ finish: 'foil', usd: 6 })
    expect(listPrice(prices, ['etched'])).toEqual({ finish: 'etched', usd: 4 })
    expect(listPrice({ usd: null, usdFoil: null, usdEtched: null }, ['nonfoil'])).toBeNull()
  })

  it('ignores prices for finishes the printing does not come in', () => {
    expect(listPrice({ usd: null, usdFoil: 6, usdEtched: null }, ['nonfoil'])).toBeNull()
  })
})
