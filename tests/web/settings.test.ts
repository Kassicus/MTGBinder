import { describe, expect, it } from 'vitest'
import { compactedToast, librarySizeText } from '../../src/web/lib/settings.ts'

describe('librarySizeText', () => {
  it('splits the size into the library and its log, and says the unused space is what compacting gives back', () => {
    expect(librarySizeText({ bytes: 460_668_928, freeBytes: 217_829_376, logBytes: 250_178_792 })).toEqual({
      size: '711 MB (461 MB library + 250 MB log)',
      unused: '218 MB (Compact gives it back)',
      worthIt: true,
    })
  })

  it('leaves out a log under 1 MB, and says when there is nothing to compact', () => {
    expect(librarySizeText({ bytes: 241_504_256, freeBytes: 843_776, logBytes: 999_999 })).toEqual({
      size: '243 MB',
      unused: 'Hardly any: nothing to compact',
      worthIt: false,
    })
    expect(librarySizeText({ bytes: 241_504_256, freeBytes: 843_776, logBytes: 1_000_000 }).size).toBe(
      '243 MB (242 MB library + 1.0 MB log)',
    )
  })
})

describe('compactedToast', () => {
  it('says the sizes Settings shows, the file and its log together, and the backup it saved first', () => {
    const before = { bytes: 460_668_928, freeBytes: 217_829_376, logBytes: 250_178_792 }
    const after = { bytes: 241_516_544, freeBytes: 843_776, logBytes: 0 }
    expect(compactedToast({ before, after, backup: 'binder-2026-09-28-2.db' })).toBe(
      'Compacted the library from 711 MB to 242 MB, after saving binder-2026-09-28-2.db.',
    )
    // A write right after the compaction starts the log again: it counts after too.
    expect(compactedToast({ before, after: { ...after, logBytes: 4_000_000 }, backup: 'binder-2026-09-28-2.db' })).toBe(
      'Compacted the library from 711 MB to 246 MB, after saving binder-2026-09-28-2.db.',
    )
  })
})
