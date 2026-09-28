import { memo } from 'react'
import { Link } from 'react-router'
import { FORMATS } from '../../../shared/formats.ts'
import { modelName } from '../../../shared/models.ts'
import type { ChatItem, CreatedDeck } from '../../../shared/types.ts'
import { completionPercent } from '../../lib/deck-view.ts'
import { formatUsd, plural } from '../../lib/format.ts'
import { Markdown } from './Markdown.tsx'

/** An activity line with its `code` spans shown as code: "Searching your library for `t:elf`". */
function Activity({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]*`)/).map((part, i) =>
        part.startsWith('`') && part.endsWith('`') && part.length > 1 ? (
          <code key={i} className="rounded bg-stone-800/80 px-1 font-mono text-xs text-stone-200">
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </>
  )
}

function DeckCard({ deck }: { deck: CreatedDeck }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-stone-50">{deck.name}</p>
        <p className="text-xs text-stone-400">
          {FORMATS[deck.format]?.label ?? deck.format} · prospective · {plural(deck.cardCount, 'card')} ·{' '}
          {completionPercent(deck.completion)}% owned · {formatUsd(deck.costToFinish)} to finish
        </p>
        {deck.unresolved.length > 0 && (
          <p className="text-xs text-amber-300/80">Left out (no card by that name): {deck.unresolved.join(', ')}</p>
        )}
      </div>
      <Link to={`/decks/${deck.id}`} className="rounded-md bg-amber-500 px-3 py-1 text-sm font-medium text-stone-950 hover:bg-amber-400">
        Open in deckbuilder
      </Link>
    </div>
  )
}

/**
 * One item of a conversation (spec §5.5). `live`: it's the item Claude is writing right now. Memoized: each piece of an
 * answer draws the conversation again, and only the item it changed needs its Markdown read again.
 */
export const ChatItemView = memo(function ChatItemView({ item, live = false }: { item: ChatItem; live?: boolean }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="ml-auto max-w-[85%] space-y-1 rounded-2xl rounded-br-sm bg-stone-800 px-4 py-2.5 text-stone-100 wrap-break-word">
          {item.deck !== null && <p className="text-xs text-amber-300/80">About the deck {item.deck}</p>}
          <p className="whitespace-pre-wrap">{item.text}</p>
        </div>
      )
    case 'text':
      return item.text === '' && live ? (
        <p className="animate-pulse text-stone-500">…</p>
      ) : (
        <div className="text-stone-200">
          <Markdown text={item.text} />
        </div>
      )
    case 'note':
      // A note arrives with its first words; while Claude works silently, ChatView shows "Thinking…".
      return <p className="border-l border-stone-800 pl-3 text-sm whitespace-pre-line text-stone-400 wrap-break-word">{item.text}</p>
    case 'tool':
      return (
        <div className="text-sm wrap-break-word">
          <p className={item.state === 'failed' ? 'text-rose-300' : 'text-stone-400'}>
            <span aria-hidden className={`mr-1.5 inline-block w-4 text-center ${item.state === 'running' ? 'animate-spin' : ''}`}>
              {item.state === 'running' ? '◌' : item.state === 'done' ? '✓' : '✕'}
            </span>
            <Activity text={item.activity} />
            {item.state === 'running' && '…'}
          </p>
          {item.error && <p className="ml-6 text-xs text-rose-300/80">{item.error}</p>}
          {item.deck && <DeckCard deck={item.deck} />}
        </div>
      )
    case 'fallback':
      return (
        <p className="text-xs text-stone-500">
          {modelName(item.from)} declined part of this; {modelName(item.to)} carried on.
        </p>
      )
    case 'notice':
      return <p className={`text-sm ${item.tone === 'error' ? 'text-rose-300' : 'text-stone-500'}`}>{item.text}</p>
  }
})
