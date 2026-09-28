import { describe, expect, it } from 'vitest'
import type { ImportPreview, ImportRow } from '../../src/shared/types.ts'
import { importItems } from '../../src/web/lib/import-items.ts'

function row(status: ImportRow['status'], id: string | null, quantity: number): ImportRow {
  return {
    line: 2,
    status,
    input: { name: 'x', set: '', collectorNumber: '' },
    quantity,
    finish: 'foil',
    card: id ? { id, name: 'x', setCode: 's', setName: 'S', collectorNumber: '1' } : null,
    note: null,
  }
}

const preview: ImportPreview = {
  rows: [row('resolved', 'a', 2), row('ambiguous', 'b', 3), row('unresolved', null, 1), row('resolved', 'a', 1)],
  counts: { resolved: 2, ambiguous: 1, unresolved: 1 },
}

describe('importItems', () => {
  it('adds resolved rows and, when asked, ambiguous ones; never unresolved ones', () => {
    expect(importItems(preview, true)).toEqual({
      items: [
        { cardId: 'a', finish: 'foil', quantity: 2 },
        { cardId: 'b', finish: 'foil', quantity: 3 },
        { cardId: 'a', finish: 'foil', quantity: 1 },
      ],
      copies: 6,
    })
    expect(importItems(preview, false).copies).toBe(3)
  })
})
