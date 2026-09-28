import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { CardDetail, CardSummary, Finish, ScanItem } from '../../../shared/types.ts'
import { apiGet } from '../../lib/api.ts'
import { useCardDrawer } from '../../lib/card-drawer.tsx'
import { BOARD_LABEL, useDecks } from '../../lib/decks.ts'
import { useDiscardScan, useEditScan, useRetryScan } from '../../lib/scan.ts'
import { useDebounced } from '../../lib/use-debounced.ts'
import { TargetPicker } from './ScanTarget.tsx'

const FINISH_LABEL: Record<Finish, string> = { nonfoil: 'Nonfoil', foil: 'Foil', etched: 'Etched' }
const small = 'rounded-md border border-stone-700 px-2 py-0.5 text-xs text-stone-200 hover:bg-stone-800 disabled:opacity-50'

function Badge({ item }: { item: ScanItem }) {
  const base = 'rounded-full px-2 py-0.5 text-xs font-medium'
  if (item.status === 'queued' || item.status === 'identifying') {
    return <span className={`${base} animate-pulse bg-stone-800 text-stone-300`}>Identifying…</span>
  }
  if (item.status === 'confident') {
    // The owner picked the card, or said OCR's pick looks right.
    const how = item.method === 'manual' ? 'confirmed' : 'by OCR'
    return <span className={`${base} bg-emerald-900/60 text-emerald-200`}>Ready · {how}</span>
  }
  if (item.reason === 'printing') return <span className={`${base} bg-amber-900/60 text-amber-200`}>Check the printing</span>
  return <span className={`${base} bg-rose-900/60 text-rose-200`}>Not sure</span>
}

/** Finds any card by name, for scans OCR couldn't settle (spec §5.1.3). */
function CardPicker({ onPick }: { onPick: (cardId: string) => void }) {
  const [text, setText] = useState('')
  const query = useDebounced(text.trim(), 150)
  const { data } = useQuery({
    queryKey: ['autocomplete', query],
    queryFn: ({ signal }) => apiGet<CardSummary[]>(`/api/cards/autocomplete?q=${encodeURIComponent(query)}&limit=6`, signal),
    enabled: query.length > 1,
  })
  return (
    <div className="space-y-1">
      <input
        aria-label="Find the card"
        placeholder="Find the card…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-sm text-stone-100 outline-none focus:border-amber-500/70"
      />
      {query.length > 1 && data && (
        <ul className="space-y-0.5">
          {data.length === 0 && <li className="text-xs text-stone-500">No card by that name.</li>}
          {data.map((card) => (
            <li key={card.cardId}>
              <button onClick={() => onPick(card.cardId)} className="text-left text-sm text-stone-200 hover:text-amber-300">
                {card.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Every printing of the scanned card, newest first, to correct the printing (spec §5.1.3). `picked`: a printing chosen
 * and still being saved, shown meanwhile.
 */
function PrintingSelect({
  item,
  picked,
  disabled,
  onPick,
}: {
  item: ScanItem
  picked: string | undefined
  disabled: boolean
  onPick: (cardId: string) => void
}) {
  const card = item.card!
  const { data } = useQuery({
    queryKey: ['card', card.id],
    queryFn: ({ signal }) => apiGet<CardDetail>(`/api/cards/${encodeURIComponent(card.id)}`, signal),
  })
  return (
    <select
      aria-label={`Printing of ${card.name}`}
      value={picked ?? card.id}
      onChange={(e) => onPick(e.target.value)}
      disabled={disabled}
      className="max-w-full rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-100 disabled:opacity-50"
    >
      {(data?.printings ?? [{ id: card.id, setCode: card.setCode, setName: card.setName, collectorNumber: card.collectorNumber }]).map((p) => (
        <option key={p.id} value={p.id}>
          {p.setCode.toUpperCase()} · {p.setName} #{p.collectorNumber}
        </option>
      ))}
    </select>
  )
}

/** Where one scan goes besides the collection, and a way to change it: for a scan captured with the wrong deck chosen. */
function ScanRowTarget({ item }: { item: ScanItem }) {
  const { data: decks } = useDecks()
  const edit = useEditScan(item.id)
  const [changing, setChanging] = useState(false)
  // A scan still being read has no card name yet.
  const name = item.card?.name ?? `scan ${item.id}`
  if (!item.target && !decks?.length) return null
  if (changing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <TargetPicker
          label={`Deck for ${name}`}
          // The choice being saved, until the queue shows it.
          target={edit.isPending && edit.variables.target !== undefined ? edit.variables.target : item.target}
          disabled={edit.isPending}
          onChange={(target) => edit.mutate({ target }, { onSuccess: () => setChanging(false) })}
        />
        <button aria-label={`Done choosing the deck for ${name}`} onClick={() => setChanging(false)} className={small}>
          Done
        </button>
      </div>
    )
  }
  return (
    <p className="text-xs text-stone-400">
      {item.target ? (
        <>
          For <span className="text-stone-200">{item.target.deckName}</span> · {BOARD_LABEL[item.target.board]}{' '}
        </>
      ) : (
        'Collection only '
      )}
      <button
        aria-label={item.target ? `Change the deck for ${name}` : `Add to a deck: ${name}`}
        onClick={() => setChanging(true)}
        className="text-amber-300 hover:underline"
      >
        {item.target ? 'Change' : 'Add to a deck…'}
      </button>
    </p>
  )
}

/**
 * One scan in the queue (spec §5.1.3): the capture next to Scryfall's image, what it was identified as, where it goes,
 * and the controls to correct the printing, finish, and quantity, confirm it, pick another card (any review row), or
 * discard it. A mark says when auto mode may have captured this card twice.
 */
export function ScanRow({ item }: { item: ScanItem }) {
  const edit = useEditScan(item.id)
  const discard = useDiscardScan(item.id)
  const retry = useRetryScan(item.id)
  const drawer = useCardDrawer()
  const [picking, setPicking] = useState(false)
  const busy = item.status === 'queued' || item.status === 'identifying'
  const card = item.card
  const pick = (cardId: string) => edit.mutate({ cardId }, { onSuccess: () => setPicking(false) })
  return (
    <li className="flex gap-3 py-3">
      <img src={`/api/scan/items/${item.id}/image`} alt="Capture" className="h-28 w-20 shrink-0 rounded-md bg-stone-900 object-cover" />
      {card?.imageSmall ? (
        <img src={card.imageSmall} alt="" className="h-28 w-20 shrink-0 rounded-md bg-stone-900" />
      ) : (
        <div className="h-28 w-20 shrink-0 rounded-md border border-dashed border-stone-700" />
      )}
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {card ? (
              <button onClick={() => drawer.open(card.id)} className="max-w-full truncate text-left font-medium text-stone-100 hover:text-amber-300">
                {card.name}
              </button>
            ) : (
              <span className="text-stone-400">{busy ? 'Reading the card…' : 'Unknown card'}</span>
            )}
            {card && (
              <p className="text-xs text-stone-500">
                {card.setName} · {card.setCode.toUpperCase()} #{card.collectorNumber}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge item={item} />
            <button aria-label="Discard" onClick={() => discard.mutate()} disabled={discard.isPending} className="text-stone-500 hover:text-rose-300">
              ✕
            </button>
          </div>
        </div>

        <ScanRowTarget item={item} />

        {item.sameCardAsBefore && !busy && (
          <p className="text-xs text-amber-300">Same card as the scan before it. Discard it if the camera caught one card twice.</p>
        )}

        {!busy && card && (
          <div className="flex flex-wrap items-center gap-2">
            <PrintingSelect
              item={item}
              picked={edit.isPending ? edit.variables.cardId : undefined}
              disabled={edit.isPending}
              onPick={(cardId) => edit.mutate({ cardId })}
            />
            <div role="radiogroup" aria-label="Finish" className="flex gap-1">
              {card.finishes.map((f) => (
                <button
                  key={f}
                  role="radio"
                  aria-checked={item.finish === f}
                  onClick={() => edit.mutate({ finish: f })}
                  disabled={edit.isPending}
                  className={`rounded-md px-2 py-0.5 text-xs disabled:opacity-50 ${item.finish === f ? 'bg-amber-500 text-stone-950' : 'border border-stone-700 text-stone-300'}`}
                >
                  {FINISH_LABEL[f]}
                </button>
              ))}
            </div>
            <span className="flex items-center gap-1">
              <button aria-label="One fewer" disabled={edit.isPending || item.quantity <= 1} onClick={() => edit.mutate({ quantity: item.quantity - 1 })} className={small}>
                −
              </button>
              <span className="w-6 text-center text-sm tabular-nums">{item.quantity}</span>
              <button aria-label="One more" disabled={edit.isPending || item.quantity >= 999} onClick={() => edit.mutate({ quantity: item.quantity + 1 })} className={small}>
                +
              </button>
            </span>
            {item.status === 'review' && (
              <button onClick={() => edit.mutate({ confirm: true })} disabled={edit.isPending} className={`${small} border-emerald-800 text-emerald-200`}>
                Looks right
              </button>
            )}
            {item.status === 'review' && item.reason === 'printing' && !picking && (
              <button onClick={() => setPicking(true)} className={small}>
                Different card…
              </button>
            )}
          </div>
        )}

        {item.status === 'review' && (item.reason === 'unsure' || picking) && (
          <div className="space-y-2">
            {item.reason === 'unsure' && item.candidates.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {item.candidates
                  .filter((c) => c.cardId !== card?.id)
                  .map((c) => (
                    <button key={c.cardId} onClick={() => pick(c.cardId)} className={small}>
                      {c.name} ({c.setCode.toUpperCase()} #{c.collectorNumber})
                    </button>
                  ))}
              </div>
            )}
            <CardPicker onPick={pick} />
          </div>
        )}

        {item.status === 'review' && item.error && (
          <p className="text-xs text-rose-300">
            {item.error}{' '}
            <button onClick={() => retry.mutate()} disabled={retry.isPending} className="text-amber-300 hover:underline">
              Try again
            </button>
          </p>
        )}
      </div>
    </li>
  )
}
