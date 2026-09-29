import { isComplete, percentLabel, setPercent } from '../../lib/sets.ts'

/**
 * How much of a set is owned: a bar, owned / total, and the percentage (spec §5.8). A complete set's bar is gold, with
 * a check mark; a set with cards owned keeps a sliver of bar under 1%, so it never looks empty.
 */
export function SetBar({ owned, total, label }: { owned: number; total: number; label: string }) {
  const percent = setPercent(owned, total)
  const complete = isComplete({ owned, total })
  return (
    <div className="flex items-center gap-3 text-sm">
      <div
        className="h-2 min-w-0 flex-1 overflow-hidden rounded bg-stone-800"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={`h-full rounded ${complete ? 'bg-amber-400' : 'bg-emerald-600'}`}
          style={{ width: owned > 0 ? `max(${percent}%, 3px)` : '0' }}
        />
      </div>
      <span className="shrink-0 text-stone-300 tabular-nums">
        {owned.toLocaleString('en-US')} / {total.toLocaleString('en-US')}
      </span>
      <span className={`w-14 shrink-0 text-right tabular-nums ${complete ? 'font-medium text-amber-300' : 'text-stone-400'}`}>
        {complete ? '✓ 100%' : percentLabel(owned, total)}
      </span>
    </div>
  )
}
