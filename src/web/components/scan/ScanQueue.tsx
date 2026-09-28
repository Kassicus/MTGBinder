import { useState } from 'react'
import type { ScanTarget } from '../../../shared/types.ts'
import { useDecks } from '../../lib/decks.ts'
import { plural } from '../../lib/format.ts'
import { useCommitScans, useScanItems, useSkippedCaptures, useTargetAllScans } from '../../lib/scan.ts'
import { addLabel, skippedNote } from '../../lib/scan-queue.ts'
import { ScanRow } from './ScanRow.tsx'
import { TargetPicker } from './ScanTarget.tsx'

const small = 'rounded-md border border-stone-700 px-2 py-0.5 text-xs text-stone-200 hover:bg-stone-800 disabled:opacity-50'

/**
 * Sends every scan in the queue to one deck's board, or to the collection only, for a session begun with the wrong
 * deck. It starts from where new captures go (`target`), and new captures go where it sent the scans (`onSent`).
 */
function SendAll({
  count,
  target,
  onSent,
}: {
  count: number
  target: ScanTarget | null
  onSent: (target: ScanTarget | null) => void
}) {
  const { data: decks } = useDecks()
  const send = useTargetAllScans()
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState<ScanTarget | null>(null)
  // An emptied queue closes the form, so it doesn't open again later with an old choice.
  if (count === 0 && open) setOpen(false)
  if (count === 0 || !decks?.length) return null
  if (!open) {
    return (
      <button
        onClick={() => {
          setTo(target)
          setOpen(true)
        }}
        className="text-xs text-amber-300 hover:underline"
      >
        Send every scan here to…
      </button>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-stone-400">Send {count === 1 ? 'the scan' : `all ${plural(count, 'scan')}`} here to</span>
      <TargetPicker label="Send every scan to" target={to} onChange={setTo} disabled={send.isPending} />
      <button
        onClick={() =>
          send.mutate(to, {
            onSuccess: () => {
              setOpen(false)
              onSent(to)
            },
          })
        }
        disabled={send.isPending}
        className={small}
      >
        {send.isPending ? 'Sending…' : 'Send'}
      </button>
      <button onClick={() => setOpen(false)} className={small}>
        Cancel
      </button>
    </div>
  )
}

/**
 * The scan queue (spec §5.1.3), newest first, with Add for everything that's ready (the rows it counts), to the
 * collection and each scan's deck. Auto mode's likely second captures of one card are marked. `target` is where new
 * captures go, which sending every scan elsewhere changes (`onTarget`).
 */
export function ScanQueue({ target, onTarget }: { target: ScanTarget | null; onTarget: (target: ScanTarget | null) => void }) {
  const { data: items, error } = useScanItems()
  const skipped = skippedNote(useSkippedCaptures())
  const commit = useCommitScans()
  const ready = items?.filter((i) => i.status === 'confident') ?? []
  const toCheck = items?.filter((i) => i.status === 'review').length ?? 0
  const reading = items?.filter((i) => i.status === 'queued' || i.status === 'identifying').length ?? 0
  const copies = ready.reduce((sum, i) => sum + i.quantity, 0)
  return (
    <section aria-label="Scans" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-400">
          <span className="text-stone-100 tabular-nums">{ready.length}</span> ready ·{' '}
          <span className="text-stone-100 tabular-nums">{toCheck}</span> to check
          {reading > 0 && (
            <>
              {' '}· <span className="text-stone-100 tabular-nums">{reading}</span> reading
            </>
          )}
        </p>
        <button
          onClick={() => commit.mutate(ready.map((i) => i.id))}
          disabled={copies === 0 || commit.isPending}
          className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-stone-950 hover:bg-amber-400 disabled:opacity-50"
        >
          {commit.isPending ? 'Adding…' : addLabel(ready)}
        </button>
      </div>
      <SendAll count={items?.length ?? 0} target={target} onSent={onTarget} />
      {skipped && <p className="text-xs text-stone-500">{skipped}</p>}
      {error && <p className="text-sm text-rose-300">Couldn't load the queue: {error.message}</p>}
      {items && items.length === 0 && (
        <p className="py-10 text-center text-stone-500">
          Captured cards appear here. Place a card in the guide and press Capture or Space, or switch to Auto to capture
          each card as you set it down.
        </p>
      )}
      <ul className="divide-y divide-stone-800">
        {[...(items ?? [])].reverse().map((item) => (
          <ScanRow key={item.id} item={item} />
        ))}
      </ul>
    </section>
  )
}
