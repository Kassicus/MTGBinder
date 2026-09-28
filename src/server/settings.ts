import type { Finish, Settings } from '../shared/types.ts'
import type { DB } from './db/index.ts'
import { getMeta, setMeta } from './db/meta.ts'

const FINISHES: readonly Finish[] = ['nonfoil', 'foil', 'etched']

/** The owner's preferences, stored in `meta` (spec §4.1). Missing keys take their defaults. */
export function getSettings(db: DB): Settings {
  const finish = getMeta(db, 'scan_default_finish') as Finish | null
  return {
    buylistIgnoreBasics: getMeta(db, 'buylist_ignore_basics') !== '0',
    scanAutoCommit: getMeta(db, 'scan_auto_commit') === '1',
    scanDefaultFinish: finish && FINISHES.includes(finish) ? finish : 'nonfoil',
    scanAcceptUncertainPrinting: getMeta(db, 'scan_accept_uncertain_printing') === '1',
  }
}

const flag = (on: boolean) => (on ? '1' : '0')

/** Changes the given settings and returns them all. */
export function updateSettings(db: DB, patch: Partial<Settings>): Settings {
  db.transaction(() => {
    if (patch.buylistIgnoreBasics !== undefined) setMeta(db, 'buylist_ignore_basics', flag(patch.buylistIgnoreBasics))
    if (patch.scanAutoCommit !== undefined) setMeta(db, 'scan_auto_commit', flag(patch.scanAutoCommit))
    if (patch.scanDefaultFinish !== undefined) setMeta(db, 'scan_default_finish', patch.scanDefaultFinish)
    if (patch.scanAcceptUncertainPrinting !== undefined) {
      setMeta(db, 'scan_accept_uncertain_printing', flag(patch.scanAcceptUncertainPrinting))
    }
  })()
  return getSettings(db)
}
