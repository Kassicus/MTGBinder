import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { BuyListTab } from '../components/decks/BuyListTab.tsx'
import { CardSearchPanel } from '../components/decks/CardSearchPanel.tsx'
import { DeckHeader } from '../components/decks/DeckHeader.tsx'
import { DeckLines } from '../components/decks/DeckLines.tsx'
import { DeckPanels } from '../components/decks/DeckPanels.tsx'
import { ImportExportTab } from '../components/decks/ImportExportTab.tsx'
import { isDeckGone, useDeck } from '../lib/decks.ts'

type Tab = 'deck' | 'buy' | 'io'

/** One deck: search on the left, the list in the middle, panels on the right; plus buy list and import/export tabs. */
export function DeckEditorPage() {
  const id = Number(useParams().id)
  const { data: deck, error, isPending } = useDeck(id)
  const [tab, setTab] = useState<Tab>('deck')

  // A failed background refetch keeps the loaded editor (and what's typed in it), unless the deck is gone: deleted in
  // another window, say, when every edit would fail.
  if (error && (!deck || isDeckGone(error))) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-rose-300">
          {isDeckGone(error) ? (deck ? `${deck.name} was deleted.` : 'There is no such deck.') : error.message}
        </p>
        <Link to="/decks" className="text-amber-300 hover:underline">
          ← All decks
        </Link>
      </div>
    )
  }
  if (isPending || !deck) return <p className="text-stone-500">Loading…</p>

  const tabs: Array<[Tab, string]> = [
    ['deck', 'Deck'],
    ['buy', `Buy list (${deck.buyList.items.length})`],
    ['io', 'Import / Export'],
  ]
  return (
    <div className="space-y-5">
      <Link to="/decks" className="text-sm text-stone-500 hover:text-stone-200">
        ← All decks
      </Link>
      <DeckHeader
        key={deck.id}
        deck={deck}
        onShowWarnings={() => {
          setTab('deck')
          requestAnimationFrame(() => document.getElementById('deck-health')?.scrollIntoView({ behavior: 'smooth' }))
        }}
      />
      <div className="flex border-b border-stone-800" role="tablist">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === value ? 'border-amber-500 text-stone-50' : 'border-transparent text-stone-400 hover:text-stone-100'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'deck' && (
        <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)_17rem]">
          <CardSearchPanel deckId={deck.id} />
          <DeckLines deck={deck} />
          <div className="lg:col-span-2 xl:col-span-1">
            <DeckPanels deck={deck} />
          </div>
        </div>
      )}
      {tab === 'buy' && <BuyListTab deck={deck} />}
      {/* Keyed per deck so a paste doesn't follow to another deck; distinct from DeckHeader's key (a sibling). */}
      {tab === 'io' && <ImportExportTab key={`import-${deck.id}`} deckId={deck.id} />}
    </div>
  )
}
