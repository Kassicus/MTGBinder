import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { attachmentsOf, commanderTax, looseCards, losingReasons, visibleTo } from '../../../shared/playtest/status.ts'
import type { CardState, SeatIndex } from '../../../shared/playtest/types.ts'
import { CARD_RATIO, toScreen, type Box } from '../../lib/playtest-board.ts'
import type { SaveStatus } from '../../lib/playtest-save.ts'
import { useBoard } from './board-context.ts'
import { CardBack, CardView } from './CardView.tsx'

/** The table's parts (spec §5.9.3): each half's battlefield and side block, the hands, and the turn bar. */

/** An element's size, kept up to date as the window resizes. */
export function useElementSize(ref: RefObject<HTMLElement | null>): Box | null {
  const [size, setSize] = useState<Box | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}

/** One seat's battlefield. The seat not being viewed is drawn flipped, its edge at the top. */
export function Battlefield({ seat, fieldRef }: { seat: SeatIndex; fieldRef?: RefObject<HTMLDivElement | null> }) {
  const board = useBoard()
  const own = useRef<HTMLDivElement>(null)
  const ref = fieldRef ?? own
  const size = useElementSize(ref)
  const flipped = seat !== board.viewer
  return (
    <div
      ref={ref}
      data-drop={`battlefield-${seat}`}
      aria-label={`${board.game.seats[seat]!.name}'s battlefield`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && e.button === 0) board.beginBoxSelect(e, seat)
      }}
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) board.openFieldMenu(e, seat)
      }}
      className={`relative min-h-0 flex-1 overflow-hidden rounded-lg border border-stone-800 bg-stone-900/40 ${board.attaching ? 'cursor-crosshair' : ''}`}
    >
      {size &&
        looseCards(board.game, seat).map((card, i) => <FieldCard key={card.id} card={card} layer={i} size={size} flipped={flipped} />)}
    </div>
  )
}

/** A card at its spot, with the cards attached to it tucked behind, peeking out toward the middle of the table. */
function FieldCard({ card, layer, size, flipped }: { card: CardState; layer: number; size: Box; flipped: boolean }) {
  const board = useBoard()
  const height = board.cardHeight
  const width = height / CARD_RATIO
  const { x, y } = toScreen(card.pos!, size, flipped)
  const tucked = attachmentsOf(board.game, card)
  const peek = height * 0.22 * (flipped ? 1 : -1)
  return (
    <>
      {tucked.map((a, i) => (
        <Placed key={a.id} card={a} left={x - width / 2} top={y - height / 2 + peek * (tucked.length - i)} z={layer * 10 + i} />
      ))}
      <Placed card={card} left={x - width / 2} top={y - height / 2} z={layer * 10 + 9} />
    </>
  )
}

function Placed({ card, left, top, z }: { card: CardState; left: number; top: number; z: number }) {
  const board = useBoard()
  return (
    <div
      data-card={card.id}
      style={{ left, top, zIndex: z, transform: card.tapped ? 'rotate(90deg)' : undefined }}
      onPointerDown={(e) => board.beginCardDrag(e, card.id, 'battlefield')}
      onContextMenu={(e) => board.openCardMenu(e, card.id)}
      onPointerEnter={() => board.setHovered(card.id)}
      onPointerLeave={() => board.setHovered(null)}
      className="absolute cursor-grab transition-transform duration-150"
    >
      <CardView
        data={board.game.data[card.id]!}
        card={card}
        height={board.cardHeight}
        hidden={!visibleTo(card, board.viewer)}
        selected={board.selection.has(card.id)}
      />
    </div>
  )
}

/** The hand of the seat being viewed, face up; the other's is card backs and a count. */
export function HandStrip({ seat }: { seat: SeatIndex }) {
  const board = useBoard()
  const ref = useRef<HTMLDivElement>(null)
  const size = useElementSize(ref)
  const hand = board.game.seats[seat]!.hand
  if (seat !== board.viewer) {
    return (
      <div data-drop={`hand-${seat}`} aria-label={`${board.game.seats[seat]!.name}'s hand`} className="flex h-9 shrink-0 items-center justify-center">
        {hand.slice(0, 15).map((id, i) => (
          <CardBack key={id} height={34} className={i > 0 ? '-ml-4' : ''} />
        ))}
        <span className="ml-3 text-xs text-stone-500">{hand.length === 1 ? '1 card in hand' : `${hand.length} cards in hand`}</span>
      </div>
    )
  }
  const height = Math.round(board.cardHeight * 1.2)
  const width = height / CARD_RATIO
  // Cards overlap once the hand is wider than the strip.
  const room = (size?.width ?? 0) - width
  const step = hand.length > 1 ? Math.min(width + 6, room / (hand.length - 1)) : 0
  return (
    <div
      ref={ref}
      data-drop={`hand-${seat}`}
      aria-label="Your hand"
      style={{ height: height + 10 }}
      className="relative flex shrink-0 justify-center"
    >
      {hand.length === 0 && <p className="self-center text-xs text-stone-600">No cards in hand</p>}
      {hand.map((id, i) => (
        <div
          key={id}
          data-card={id}
          style={{ marginLeft: i === 0 ? 0 : step - width }}
          onPointerDown={(e) => board.beginCardDrag(e, id, 'hand')}
          onDoubleClick={() => board.playCard(id)}
          onContextMenu={(e) => board.openCardMenu(e, id)}
          onPointerEnter={() => board.setHovered(id)}
          onPointerLeave={() => board.setHovered(null)}
          className="cursor-grab pt-2 transition-transform hover:-translate-y-2"
        >
          <CardView data={board.game.data[id]!} height={height} />
        </div>
      ))}
    </div>
  )
}

/** A number with − and + (each a step of 1); clicking the number lets me type a new one. */
function Tally({ label, value, big = false, onChange }: { label: string; value: number; big?: boolean; onChange: (delta: number) => void }) {
  const [editing, setEditing] = useState<string | null>(null)
  const commit = () => {
    const next = Number(editing)
    if (editing !== null && editing.trim() !== '' && Number.isInteger(next) && next !== value) onChange(next - value)
    setEditing(null)
  }
  return (
    <div className="flex items-center justify-between gap-1">
      <span title={label} className={`min-w-0 truncate ${big ? 'text-stone-300' : 'text-xs text-stone-400'}`}>
        {label}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <button aria-label={`${label}: one less`} onClick={() => onChange(-1)} className="size-6 rounded border border-stone-700 text-stone-300 hover:bg-stone-800">
          −
        </button>
        {editing === null ? (
          <button
            aria-label={`${label}: ${value}. Click to type a number`}
            onClick={() => setEditing(String(value))}
            className={`min-w-9 rounded text-center tabular-nums hover:bg-stone-800 ${big ? 'text-2xl leading-7 font-bold text-stone-50' : 'text-sm text-stone-100'}`}
          >
            {value}
          </button>
        ) : (
          <input
            autoFocus
            aria-label={label}
            inputMode="numeric"
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setEditing(null)
            }}
            className="w-12 rounded border border-stone-600 bg-stone-950 px-1 text-center text-stone-50"
          />
        )}
        <button aria-label={`${label}: one more`} onClick={() => onChange(1)} className="size-6 rounded border border-stone-700 text-stone-300 hover:bg-stone-800">
          +
        </button>
      </div>
    </div>
  )
}

/** A seat's name, life, poison, commander damage taken, and its piles: library, graveyard, exile, command zone. */
export function SideBlock({ seat }: { seat: SeatIndex }) {
  const board = useBoard()
  const { game, play } = board
  const s = game.seats[seat]!
  const enemy = game.seats.length === 2 ? (seat === 0 ? 1 : 0) : null
  const enemyCommanders = enemy === null ? [] : Object.values(game.cards).filter((c) => c.commander && c.owner === enemy)
  const reasons = losingReasons(s)
  // Four piles in a row fit the block's width up to 64 px tall.
  const pile = Math.min(64, Math.max(48, Math.round(board.cardHeight * 0.6)))
  return (
    <aside
      aria-label={`${s.name}, seat ${seat + 1}`}
      className="flex w-60 shrink-0 flex-col gap-1.5 overflow-y-auto rounded-lg border border-stone-800 bg-stone-900/60 p-2 text-sm"
    >
      <div className="flex items-center gap-2">
        {game.active === seat && <span aria-label="Their turn" className="size-2 shrink-0 rounded-full bg-amber-400" />}
        <span className="truncate font-serif text-base text-amber-400" title={s.name}>
          {s.name}
        </span>
      </div>
      {reasons.length > 0 && (
        <p role="status" className="rounded bg-red-900/70 px-2 py-0.5 text-xs text-red-100">
          Would lose: {reasons.join(', ')}
        </p>
      )}
      <Tally label="Life" value={s.life} big onChange={(delta) => play({ type: 'life', seat, delta })} />
      <Tally label="Poison" value={s.poison} onChange={(delta) => play({ type: 'poison', seat, delta })} />
      {enemyCommanders.map((c) => (
        <Tally
          key={c.id}
          label={`From ${game.data[c.id]!.name}`}
          value={s.commanderDamage[c.id] ?? 0}
          onChange={(delta) => play({ type: 'commanderDamage', seat, commander: c.id, delta })}
        />
      ))}
      <div className="flex items-end gap-2">
        <Library seat={seat} height={pile} />
        <PublicPile seat={seat} zone="graveyard" label="Grave" height={pile} />
        <PublicPile seat={seat} zone="exile" label="Exile" height={pile} />
        <CommandZone seat={seat} height={pile} />
      </div>
    </aside>
  )
}

function Library({ seat, height }: { seat: SeatIndex; height: number }) {
  const board = useBoard()
  const count = board.game.seats[seat]!.library.length
  return (
    <button
      data-drop={`library-${seat}`}
      aria-label={`Library, ${count === 1 ? '1 card' : `${count} cards`}. Click to draw; right-click for more`}
      title="Click to draw a card; right-click for more"
      onClick={() => board.play({ type: 'draw', seat, count: 1 })}
      onContextMenu={(e) => board.openLibraryMenu(e, seat)}
      className="flex flex-col items-center gap-0.5 text-[11px] text-stone-400"
    >
      {count > 0 ? <CardBack height={height} /> : <EmptyPile height={height} />}
      <span>Library {count}</span>
    </button>
  )
}

function PublicPile({ seat, zone, label, height }: { seat: SeatIndex; zone: 'graveyard' | 'exile'; label: string; height: number }) {
  const board = useBoard()
  const cards = board.game.seats[seat]![zone]
  const top = cards.at(-1)
  return (
    <button
      data-drop={`${zone}-${seat}`}
      aria-label={`${zone === 'graveyard' ? 'Graveyard' : 'Exile'}, ${cards.length === 1 ? '1 card' : `${cards.length} cards`}. Click to see them`}
      onClick={() => board.openPile(seat, zone)}
      onPointerEnter={() => top && board.setHovered(top)}
      onPointerLeave={() => board.setHovered(null)}
      className="flex flex-col items-center gap-0.5 text-[11px] text-stone-400"
    >
      {top ?<CardView data={board.game.data[top]!} height={height} /> : <EmptyPile height={height} />}
      <span>
        {label} {cards.length}
      </span>
    </button>
  )
}

function EmptyPile({ height }: { height: number }) {
  return <div style={{ height, width: height / CARD_RATIO }} className="rounded-[6%] border border-dashed border-stone-700" />
}

/** The command zone: its cards, and each commander's tax under them. */
function CommandZone({ seat, height }: { seat: SeatIndex; height: number }) {
  const board = useBoard()
  const ids = board.game.seats[seat]!.command
  const owned = Object.values(board.game.cards).filter((c) => c.commander && c.owner === seat)
  const taxes = owned.map((c) => `${board.game.data[c.id]!.name}: tax +${commanderTax(board.game, c.id)}`)
  return (
    <div data-drop={`command-${seat}`} aria-label="Command zone" className="flex flex-col items-center gap-0.5 text-[11px] text-stone-400">
      <div className="flex gap-1">
        {ids.map((id) => (
          <div
            key={id}
            data-card={id}
            onPointerDown={(e) => board.beginCardDrag(e, id, 'command')}
            onDoubleClick={() => board.playCard(id)}
            onContextMenu={(e) => board.openCardMenu(e, id)}
            onPointerEnter={() => board.setHovered(id)}
            onPointerLeave={() => board.setHovered(null)}
            className="cursor-grab"
          >
            <CardView data={board.game.data[id]!} height={height} />
          </div>
        ))}
        {ids.length === 0 && <EmptyPile height={height} />}
      </div>
      <span title={taxes.join('\n')}>{owned.length === 0 ? 'Command' : `Tax ${owned.map((c) => `+${commanderTax(board.game, c.id)}`).join(' / ')}`}</span>
    </div>
  )
}

/** The bar between the halves: the turn, the stack when something's on it, and the game's buttons. */
export function TurnBar({
  saveStatus,
  canUndo,
  canSwitch,
  onUndo,
  onLog,
  onSwitch,
  onEnd,
  onNextTurn,
}: {
  saveStatus: SaveStatus
  canUndo: boolean
  canSwitch: boolean
  onUndo: () => void
  onLog: () => void
  onSwitch: () => void
  onEnd: () => void
  onNextTurn: () => void
}) {
  const board = useBoard()
  const { game } = board
  return (
    <div
      data-drop="stack"
      className="flex shrink-0 items-center gap-3 rounded-lg border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm"
    >
      <div className="shrink-0">
        <span className="font-semibold text-amber-400">Turn {game.turn}</span>
        <span className="text-stone-300"> · {game.seats[game.active]!.name}</span>
      </div>
      <Stack />
      <span className="shrink-0 text-xs text-stone-500" aria-live="polite">
        {saveStatus === 'saving' ? 'Saving…' : ''}
      </span>
      <div className="flex shrink-0 gap-1.5">
        <BarButton onClick={onUndo} disabled={!canUndo} title="Undo (⌘Z)">
          Undo
        </BarButton>
        <BarButton onClick={onLog}>Log</BarButton>
        <BarButton onClick={onSwitch} disabled={!canSwitch} title="Switch side (Tab)">
          Switch side
        </BarButton>
        <BarButton onClick={onEnd}>End game</BarButton>
        <button onClick={onNextTurn} className="rounded-md border border-amber-600 bg-amber-700 px-3 py-1 font-medium text-white hover:bg-amber-600">
          Next turn
        </button>
      </div>
    </div>
  )
}

function BarButton({ children, ...props }: { children: string; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button {...props} className="rounded-md border border-stone-700 bg-stone-800 px-2.5 py-1 text-stone-200 hover:bg-stone-700 disabled:opacity-40 disabled:hover:bg-stone-800">
      {children}
    </button>
  )
}

/** What's on the stack, oldest on the left: spells as cards, abilities as tags naming their card. */
function Stack() {
  const board = useBoard()
  const { game } = board
  if (game.stack.length === 0) return <div className="flex-1" />
  return (
    <ol aria-label="The stack" className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
      <li className="shrink-0 text-xs text-stone-500">Stack:</li>
      {game.stack.map((item, i) => (
        <li
          key={item.id}
          data-card={item.kind === 'spell' ? item.id : undefined}
          title="Double-click to resolve; right-click for more"
          onDoubleClick={() => {
            // Resolving takes this item from under the pointer. An ability's hover is its source, which stays where it
            // is, so the Board can't tell the hover has ended: end it here.
            board.setHovered(null)
            board.play({ type: 'resolve', item: item.id })
          }}
          onContextMenu={(e) => board.openStackMenu(e, item.id)}
          onPointerDown={item.kind === 'spell' ? (e) => board.beginCardDrag(e, item.id, 'stack') : undefined}
          onPointerEnter={() => board.setHovered(item.kind === 'spell' ? item.id : item.source)}
          onPointerLeave={() => board.setHovered(null)}
          className={`shrink-0 ${i === game.stack.length - 1 ? 'ring-2 ring-amber-500/70' : ''} rounded`}
        >
          {item.kind === 'spell' ? (
            <CardView data={game.data[item.id]!} height={52} />
          ) : (
            <span className="block rounded bg-stone-700 px-2 py-1 text-xs text-stone-100">{item.name}: ability</span>
          )}
        </li>
      ))}
    </ol>
  )
}
