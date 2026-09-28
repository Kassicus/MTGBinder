import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import type { CollectionStats } from '../../shared/types.ts'
import { QuickFind } from '../components/QuickFind.tsx'
import { useOpenShortcuts } from '../components/ShortcutsDialog.tsx'
import { apiGet } from '../lib/api.ts'
import { formatDate } from '../lib/format.ts'
import { isBulkRunning, useBulkStatus } from '../lib/use-bulk-status.ts'

const FIRST_STEPS: ReadonlyArray<{ to: string; state?: object; title: string; text: string }> = [
  { to: '/scan', title: 'Scan your cards', text: 'Hold each card under your iPhone or webcam; Binder reads it on this Mac.' },
  {
    to: '/library',
    state: { importing: true },
    title: 'Import a CSV',
    text: 'Bring a collection over from Moxfield, Deckbox, ManaBox, Archidekt, TCGplayer, or Dragon Shield.',
  },
  { to: '/decks', title: 'Scan or build a deck', text: 'Scan a deck you own into Binder, or plan one and see what it costs to finish.' },
]

/** Three first steps, shown on Look up while the collection is empty. */
function GettingStarted() {
  const openShortcuts = useOpenShortcuts()
  return (
    <section aria-labelledby="getting-started" className="mt-12 text-left">
      <h2 id="getting-started" className="text-xs tracking-[0.2em] text-stone-500 uppercase">
        Getting started
      </h2>
      <ol className="mt-3 grid gap-3 sm:grid-cols-3">
        {FIRST_STEPS.map((step, i) => (
          <li key={step.to}>
            <Link
              to={step.to}
              state={step.state}
              className="block h-full rounded-xl border border-stone-800 bg-stone-900/40 p-4 hover:border-amber-700/60 hover:bg-stone-900"
            >
              <span className="text-xs text-amber-400 tabular-nums">{i + 1}</span>
              <p className="mt-1 font-medium text-stone-100">{step.title}</p>
              <p className="mt-1 text-sm text-stone-400">{step.text}</p>
            </Link>
          </li>
        ))}
      </ol>
      {/* A button, not "press ?": the finder above has focus here, so ? would type into it. */}
      <p className="mt-4 text-xs text-stone-500">
        <button onClick={openShortcuts} className="text-amber-300 hover:underline">
          Keyboard shortcuts
        </button>{' '}
        (or press ? anywhere but a text box or dropdown)
      </p>
    </section>
  )
}

export function HomePage() {
  const { data: status } = useBulkStatus()
  const importing = isBulkRunning(status)
  const empty = status !== undefined && status.cardCount === 0
  const stats = useQuery({
    queryKey: ['collection', 'stats'],
    queryFn: ({ signal }) => apiGet<CollectionStats>('/api/collection/stats', signal),
  })
  const nothingOwned = stats.data?.totalCards === 0

  return (
    <div className="mx-auto max-w-2xl pt-16 text-center">
      <h1 className="font-serif text-4xl font-semibold text-stone-50">Look up any card</h1>
      <p className="mt-3 text-stone-400">Every paper printing from Scryfall, searchable instantly.</p>
      <div className="mt-8 text-left">
        {empty ? (
          <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 p-5 text-amber-100">
            {importing ? (
              'Downloading card data from Scryfall. This takes about a minute.'
            ) : (
              <>
                No card data yet.{' '}
                <Link to="/settings" className="font-medium text-amber-300 underline underline-offset-2">
                  Import it from Scryfall in Settings
                </Link>{' '}
                (about a minute).
              </>
            )}
          </div>
        ) : (
          <QuickFind size="lg" autoFocus />
        )}
      </div>
      {status && !empty && (
        <p className="mt-4 text-xs text-stone-500">
          {status.cardCount.toLocaleString()} printings · updated {formatDate(status.updatedAt)}
        </p>
      )}
      {!empty && nothingOwned && <GettingStarted />}
    </div>
  )
}
