import type { DeckDetail } from '../../../shared/types.ts'
import { cardWarnings, manaCurve, typeCounts } from '../../lib/deck-view.ts'

const panel = 'space-y-2 rounded-xl border border-stone-800 bg-stone-900/40 p-4'
const heading = 'text-xs tracking-[0.2em] text-stone-500 uppercase'

/** Deck health (format warnings), mana curve, and type counts (spec §5.4.2 panels). */
export function DeckPanels({ deck }: { deck: DeckDetail }) {
  const cards = cardWarnings(deck.lines)
  const curve = manaCurve(deck.lines)
  const tallest = Math.max(1, ...curve.map((b) => b.count))
  return (
    <aside className="space-y-4">
      <section id="deck-health" aria-labelledby="deck-health-heading" className={panel}>
        <h2 id="deck-health-heading" className={heading}>
          Deck health
        </h2>
        {deck.warnings.length === 0 && cards.length === 0 ? (
          <p className="text-sm text-emerald-300">No format problems.</p>
        ) : (
          <ul className="space-y-1 text-sm text-amber-200">
            {deck.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
            {cards.map((c) => (
              <li key={c.oracleId}>
                <span className="text-stone-200">{c.name}:</span> {c.warnings.join('; ')}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="curve-heading" className={panel}>
        <h2 id="curve-heading" className={heading}>
          Mana curve
        </h2>
        <div className="flex h-28 items-end gap-1.5" role="img" aria-label={curve.map((b) => `${b.label}: ${b.count}`).join(', ')}>
          {curve.map((b) => (
            <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] text-stone-400 tabular-nums">{b.count > 0 ? b.count : ''}</span>
              <div className="w-full rounded-t bg-amber-500/80" style={{ height: `${(b.count / tallest) * 72}px` }} />
              <span className="text-[10px] text-stone-500">{b.label}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-stone-500">Main deck, not counting lands.</p>
      </section>
      <section aria-labelledby="types-heading" className={panel}>
        <h2 id="types-heading" className={heading}>
          Types
        </h2>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-sm">
          {typeCounts(deck.lines).map(({ type, count }) => (
            <div key={type} className="contents">
              <dt className="text-stone-400">{type}</dt>
              <dd className="text-right text-stone-100 tabular-nums">{count}</dd>
            </div>
          ))}
        </dl>
      </section>
    </aside>
  )
}
