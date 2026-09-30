import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type PointerEvent } from 'react'
import { list } from '../../../shared/playtest/log.ts'
import { canFlip, looseCards, visibleTo } from '../../../shared/playtest/status.ts'
import type { Action, CardState, Dest, GameState, SavedGame, SeatIndex } from '../../../shared/playtest/types.ts'
import { useDecks } from '../../lib/decks.ts'
import { useEndGame, useStartGame, type GameSession } from '../../lib/playtest.ts'
import { asksCommandZone, boardKey, cardHeight, cardsInBox, fromScreen, playDest, tapTo } from '../../lib/playtest-board.ts'
import { GO_TO_MS, isTypingTarget } from '../../lib/shortcuts.ts'
import { BoardContext, type BoardApi, type DragSource } from './board-context.ts'
import { CardView } from './CardView.tsx'
import { CommandZoneDialog, CountDialog, CounterDialog, EndGameDialog, LookDialog, SearchDialog, TokenDialog } from './dialogs.tsx'
import { ContextMenu, type MenuItem, type MenuState } from './Menu.tsx'
import { LogPanel, PilePanel, Preview } from './panels.tsx'
import { Battlefield, HandStrip, SideBlock, TurnBar, useElementSize } from './Table.tsx'

/** A drag in progress: cards following the pointer, or a box being drawn to select cards. */
type Drag =
  | {
      kind: 'cards'
      ids: string[]
      source: DragSource
      start: { x: number; y: number }
      at: { x: number; y: number }
      /** Each card's center from the pointer, and its height, when the drag began. */
      offsets: Record<string, { dx: number; dy: number; height: number }>
      moved: boolean
      shift: boolean
    }
  | { kind: 'box'; seat: SeatIndex; field: DOMRect; start: { x: number; y: number }; at: { x: number; y: number }; moved: boolean; shift: boolean }

type Dialog =
  | { kind: 'count'; title: string; label: string; initial: number; max: number; onSubmit: (n: number) => void }
  | { kind: 'look'; seat: SeatIndex; count: number }
  | { kind: 'search'; seat: SeatIndex }
  | { kind: 'counters'; ids: string[] }
  | { kind: 'token'; seat: SeatIndex }
  | { kind: 'commander'; ids: string[]; commanders: string[]; to: Dest }
  | { kind: 'end' }

/** A pointer moved this far is a drag, not a click. */
const DRAG_START_PX = 5

const other = (seat: SeatIndex): SeatIndex => (seat === 0 ? 1 : 0)

const PLACE_LABEL: Record<string, string> = {
  hand: 'Hand',
  graveyard: 'Graveyard',
  exile: 'Exile',
  library: 'Library',
}

/** The element to drop on under the pointer: the nearest one marked `data-drop` (a panel's is "none"). */
function dropTarget(x: number, y: number): HTMLElement | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const target = (el as HTMLElement).closest<HTMLElement>('[data-drop]')
    if (target) return target
  }
  return null
}

/** A card's name as the seat viewed knows it: a face-down card it can't see stays unnamed. */
function nameFor(game: GameState, id: string, viewer: SeatIndex): string {
  const card = game.cards[id]
  return card === undefined || visibleTo(card, viewer) ? game.data[id]!.name : 'A face-down card'
}

/** The playtest's table (spec §5.9.3–§5.9.6): both halves, the hands, the turn bar, and everything the page opens. */
export function Board({ saved, game, session }: { saved: SavedGame; game: GameState; session: GameSession }) {
  const { play, undo, canUndo, saveStatus } = session
  const setup = saved.setup
  const twoSeats = game.seats.length === 2
  const [viewer, setViewer] = useState<SeatIndex>(game.phase === 'playing' ? game.active : game.choosing)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  // The card under the pointer, and the zone it was in then (see `hovered` below).
  const [hoverAt, setHoverAt] = useState<{ id: string; zone: CardState['zone'] } | null>(null)
  // Where the pointer is across the window, for the preview's side: kept out of state, so moving doesn't re-render.
  const pointerX = useRef(0)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [pile, setPile] = useState<{ seat: SeatIndex; zone: 'graveyard' | 'exile' } | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const [attaching, setAttaching] = useState<string[] | null>(null)
  // The drag follows the pointer in its own layer, so the table doesn't re-render as it moves.
  const [dragStore] = useState(createDragStore)
  const [dragging, setDragging] = useState(false)
  const fieldRef = useRef<HTMLDivElement>(null)
  const field = useElementSize(fieldRef)
  const height = cardHeight(field?.height ?? 400)
  const decks = useDecks()
  const startGame = useStartGame()
  const endGame = useEndGame()

  // Only cards still on the battlefield stay selected.
  const selection = useMemo(() => new Set([...selected].filter((id) => game.cards[id]?.zone === 'battlefield')), [selected, game])

  // Handlers read the latest game and view through this, so they needn't change on every action.
  const latest = useRef({ game, viewer, selection, attaching })
  latest.current = { game, viewer, selection, attaching }

  // A card played, resolved, or moved from under the pointer takes its element with it, and no pointerleave follows:
  // once the card hovered has left the zone it was hovered in, or the game, nothing is hovered.
  if (hoverAt !== null && game.cards[hoverAt.id]?.zone !== hoverAt.zone) setHoverAt(null)
  const hovered = hoverAt?.id ?? null
  const setHovered = useCallback((id: string | null) => {
    const zone = id === null ? undefined : latest.current.game.cards[id]?.zone
    setHoverAt(id === null || zone === undefined ? null : { id, zone })
  }, [])

  const moveCards = useCallback(
    (ids: string[], to: Dest) => {
      const g = latest.current.game
      const commanders = ids.filter((id) => asksCommandZone(g.cards[id]!, to))
      if (commanders.length > 0) setDialog({ kind: 'commander', ids, commanders, to })
      else play({ type: 'move', ids, to })
    },
    [play],
  )

  const playCard = useCallback(
    (id: string) => {
      const g = latest.current.game
      const card = g.cards[id]
      if (!card) return
      play({ type: 'move', ids: [id], to: playDest(g.data[id]!.kind, card.owner) })
    },
    [play],
  )

  /** Taps a card, or the selection it's in: all of them, or untaps them when all are tapped. */
  const tapCards = useCallback(
    (id: string) => {
      const { game: g, selection: sel } = latest.current
      const ids = sel.has(id) ? [...sel] : [id]
      play({ type: 'tap', ids, tapped: tapTo(ids.map((i) => g.cards[i]!)) })
    },
    [play],
  )

  const finishDrag = useCallback(
    (d: Drag) => {
      const { game: g, viewer: v, selection: sel, attaching: waiting } = latest.current
      if (d.kind === 'box') {
        if (!d.moved) {
          if (!d.shift) setSelected(new Set())
          return
        }
        const box = {
          left: Math.min(d.start.x, d.at.x) - d.field.left,
          right: Math.max(d.start.x, d.at.x) - d.field.left,
          top: Math.min(d.start.y, d.at.y) - d.field.top,
          bottom: Math.max(d.start.y, d.at.y) - d.field.top,
        }
        const ids = cardsInBox(looseCards(g, d.seat), box, d.field, d.seat !== v)
        setSelected(d.shift ? new Set([...sel, ...ids]) : new Set(ids))
        return
      }
      const [first] = d.ids
      if (!d.moved) {
        if (d.source !== 'battlefield' || first === undefined) return
        if (waiting) {
          if (!waiting.includes(first)) for (const id of waiting) play({ type: 'attach', id, to: first })
          setAttaching(null)
        } else if (d.shift) {
          const next = new Set(sel)
          if (next.has(first)) next.delete(first)
          else next.add(first)
          setSelected(next)
        } else {
          tapCards(first)
        }
        return
      }
      const target = dropTarget(d.at.x, d.at.y)
      const drop = target?.dataset.drop
      // A panel over the table ("none") keeps a card from dropping on what's under it.
      if (!target || !drop || drop === 'none') return
      const [zone, seatText] = drop.split('-') as [string, string | undefined]
      if (zone === 'battlefield') {
        const seat = Number(seatText) as SeatIndex
        const rect = target.getBoundingClientRect()
        const at = d.ids.map((id) =>
          fromScreen({ x: d.at.x + d.offsets[id]!.dx - rect.left, y: d.at.y + d.offsets[id]!.dy - rect.top }, rect, seat !== v),
        )
        play({ type: 'move', ids: d.ids, to: { zone: 'battlefield', seat, at } })
        return
      }
      const to: Dest =
        zone === 'library'
          ? { zone: 'library', at: 'top' }
          : zone === 'stack'
            ? { zone: 'stack' }
            : { zone: zone as 'hand' | 'graveyard' | 'exile' | 'command' }
      // A card dropped back where it is stays put.
      const moving = d.ids.filter((id) => g.cards[id]!.zone !== to.zone)
      if (moving.length > 0) moveCards(moving, to)
    },
    [play, moveCards, tapCards],
  )

  // One set of window listeners follows a drag from its pointerdown to its pointerup.
  const dragRef = useRef<Drag | null>(null)
  const followDrag = useCallback(() => {
    const onMove = (e: globalThis.PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const moved = d.moved || Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) > DRAG_START_PX
      dragRef.current = { ...d, at: { x: e.clientX, y: e.clientY }, moved }
      if (moved && !d.moved) setDragging(true)
      if (moved) dragStore.set(dragRef.current)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const d = dragRef.current
      dragRef.current = null
      dragStore.set(null)
      setDragging(false)
      if (d) finishDrag(d)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [finishDrag, dragStore])

  const beginCardDrag = useCallback(
    (e: PointerEvent, id: string, source: DragSource) => {
      if (e.button !== 0) return
      e.stopPropagation()
      const { selection: sel } = latest.current
      const ids = source === 'battlefield' && sel.has(id) ? [...sel] : [id]
      const offsets: Record<string, { dx: number; dy: number; height: number }> = {}
      for (const i of ids) {
        const rect = document.querySelector(`[data-card="${CSS.escape(i)}"]`)?.getBoundingClientRect()
        offsets[i] = rect
          ? { dx: rect.left + rect.width / 2 - e.clientX, dy: rect.top + rect.height / 2 - e.clientY, height: Math.max(rect.width, rect.height) }
          : { dx: 0, dy: 0, height }
      }
      const start = { x: e.clientX, y: e.clientY }
      dragRef.current = { kind: 'cards', ids, source, start, at: start, offsets, moved: false, shift: e.shiftKey }
      followDrag()
    },
    [followDrag, height],
  )

  const beginBoxSelect = useCallback(
    (e: PointerEvent, seat: SeatIndex) => {
      const start = { x: e.clientX, y: e.clientY }
      const fieldRect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      dragRef.current = { kind: 'box', seat, field: fieldRect, start, at: start, moved: false, shift: e.shiftKey }
      followDrag()
    },
    [followDrag],
  )

  const openMenu = (e: MouseEvent, title: string, items: MenuItem[]) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, title, items })
  }

  const openCardMenu = useCallback(
    (e: MouseEvent, id: string) => {
      const { game: g, selection: sel, viewer: v } = latest.current
      const card = g.cards[id]
      if (!card) return
      const name = nameFor(g, id, v)
      const ids = card.zone === 'battlefield' && sel.has(id) ? [...sel] : [id]
      const title = ids.length > 1 ? `${ids.length} cards` : name
      const moves = (except: string): MenuItem[] =>
        (
          [
            ['hand', 'Put into hand', { zone: 'hand' }],
            ['top', 'Put on top of library', { zone: 'library', at: 'top' }],
            ['bottom', 'Put on the bottom of library', { zone: 'library', at: 'bottom' }],
            ['graveyard', 'Put into graveyard', { zone: 'graveyard' }],
            ['exile', 'Exile', { zone: 'exile' }],
            ['command', 'Put into command zone', { zone: 'command' }],
          ] as Array<[string, string, Dest]>
        )
          .filter(([key]) => key !== except)
          .map(([, label, to]) => ({ label, onSelect: () => moveCards(ids, to) }))
      if (card.zone === 'battlefield') {
        const cards = ids.map((i) => g.cards[i]!)
        const plus = cards.some((c) => (c.counters['+1/+1'] ?? 0) > 0)
        // A face-down card can't flip or be copied: either would tell the other seat what it is (or that it has two faces).
        const oneFaceUp = ids.length === 1 && !card.faceDown
        openMenu(e, title, [
          { label: tapTo(cards) ? 'Tap' : 'Untap', hint: 't', onSelect: () => play({ type: 'tap', ids, tapped: tapTo(cards) }) },
          ...(oneFaceUp && canFlip(g, id) ? [{ label: 'Flip', hint: 'f', onSelect: () => play({ type: 'flip', id }) }] : []),
          {
            label: cards.every((c) => c.faceDown) ? 'Turn face up' : 'Turn face down',
            onSelect: () => play({ type: 'faceDown', ids, down: !cards.every((c) => c.faceDown) }),
          },
          { label: 'Add a +1/+1 counter', hint: '+', onSelect: () => play({ type: 'counter', ids, name: '+1/+1', delta: 1 }) },
          ...(plus ? [{ label: 'Remove a +1/+1 counter', hint: '-', onSelect: () => play({ type: 'counter', ids, name: '+1/+1', delta: -1 }) }] : []),
          { label: 'Counters…', onSelect: () => setDialog({ kind: 'counters', ids }) },
          'separator',
          ...(card.attachedTo !== null && ids.length === 1
            ? [{ label: 'Detach', onSelect: () => play({ type: 'attach', id, to: null }) }]
            : [{ label: 'Attach to…', onSelect: () => setAttaching(ids) }]),
          ...(oneFaceUp ? [{ label: 'Copy (a token copy)', onSelect: () => play({ type: 'copy', id }) }] : []),
          { label: 'Create token…', onSelect: () => setDialog({ kind: 'token', seat: card.controller }) },
          ...(ids.length === 1 ? [{ label: 'Put an ability on the stack', onSelect: () => play({ type: 'ability', id }) }] : []),
          'separator',
          ...moves(''),
          { label: 'Reveal', onSelect: () => play({ type: 'reveal', ids }) },
        ])
        return
      }
      if (card.zone === 'hand') {
        openMenu(e, title, [
          { label: 'Play', onSelect: () => playCard(id) },
          { label: 'Put onto the battlefield', onSelect: () => moveCards(ids, { zone: 'battlefield', seat: card.owner }) },
          { label: 'Discard', onSelect: () => moveCards(ids, { zone: 'graveyard' }) },
          ...moves('hand').filter((m) => m !== 'separator' && !m.label.includes('graveyard')),
          { label: 'Put an ability on the stack', onSelect: () => play({ type: 'ability', id }) },
          { label: 'Reveal', onSelect: () => play({ type: 'reveal', ids }) },
        ])
        return
      }
      const zone = card.zone
      openMenu(e, title, [
        ...(zone === 'command' ? [{ label: 'Play', onSelect: () => playCard(id) }] : []),
        { label: 'Put onto the battlefield', onSelect: () => moveCards(ids, { zone: 'battlefield', seat: card.owner }) },
        ...moves(zone),
        { label: 'Put an ability on the stack', onSelect: () => play({ type: 'ability', id }) },
      ])
    },
    [play, moveCards, playCard],
  )

  const openLibraryMenu = useCallback(
    (e: MouseEvent, seat: SeatIndex) => {
      const { game: g, viewer: v } = latest.current
      const size = g.seats[seat]!.library.length
      const mine = seat === v
      const top = g.seats[seat]!.library[0]
      openMenu(e, `${g.seats[seat]!.name}'s library (${size})`, [
        { label: 'Draw a card', onSelect: () => play({ type: 'draw', seat, count: 1 }) },
        {
          label: 'Draw…',
          onSelect: () =>
            setDialog({ kind: 'count', title: 'Draw', label: 'Cards to draw', initial: 2, max: Math.max(1, Math.min(100, size)), onSubmit: (count) => play({ type: 'draw', seat, count }) }),
        },
        {
          label: mine ? 'Look at the top…' : 'Look at the top… (switch side first)',
          disabled: !mine || size === 0,
          onSelect: () =>
            setDialog({ kind: 'count', title: 'Look', label: 'Cards to look at', initial: 3, max: Math.min(100, size), onSubmit: (count) => setDialog({ kind: 'look', seat, count }) }),
        },
        { label: mine ? 'Search…' : 'Search… (switch side first)', disabled: !mine, onSelect: () => setDialog({ kind: 'search', seat }) },
        {
          label: 'Mill…',
          disabled: size === 0,
          onSelect: () =>
            setDialog({ kind: 'count', title: 'Mill', label: 'Cards to mill', initial: 1, max: Math.min(100, size), onSubmit: (count) => play({ type: 'mill', seat, count }) }),
        },
        { label: 'Reveal the top card', disabled: top === undefined, onSelect: () => top && play({ type: 'reveal', ids: [top] }) },
        { label: 'Shuffle', onSelect: () => play({ type: 'shuffle', seat }) },
      ])
    },
    [play],
  )

  const openFieldMenu = useCallback(
    (e: MouseEvent, seat: SeatIndex) => {
      const g = latest.current.game
      openMenu(e, `${g.seats[seat]!.name}'s battlefield`, [{ label: 'Create token…', onSelect: () => setDialog({ kind: 'token', seat }) }])
    },
    [],
  )

  const openStackMenu = useCallback(
    (e: MouseEvent, item: string) => {
      const g = latest.current.game
      const found = g.stack.find((i) => i.id === item)
      if (!found) return
      const spell = found.kind === 'spell'
      openMenu(e, spell ? g.data[item]!.name : `${found.name}: ability`, [
        { label: 'Resolve', onSelect: () => play({ type: 'resolve', item }) },
        ...(spell
          ? [
              { label: 'Put into hand', onSelect: () => moveCards([item], { zone: 'hand' }) },
              { label: 'Put into graveyard (countered)', onSelect: () => moveCards([item], { zone: 'graveyard' }) },
              { label: 'Exile', onSelect: () => moveCards([item], { zone: 'exile' }) },
            ]
          : []),
      ])
    },
    [play, moveCards],
  )

  const nextTurn = useCallback(() => {
    const g = latest.current.game
    if (play({ type: 'nextTurn' })) setViewer(g.seats.length === 2 ? other(g.active) : g.active)
  }, [play])

  const switchSide = useCallback(() => {
    if (twoSeats) setViewer((v) => other(v))
  }, [twoSeats])

  // The board's keys (spec §5.9.4). None while a field, a dialog, or a menu has them, nor right after `g`.
  // When `g` was last pressed; never, to start with (0 would hold the keys for the page's first 1.5 s).
  const lastG = useRef(-Infinity)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const now = performance.now()
      if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey) lastG.current = now
      if (isTypingTarget(e.target as HTMLElement) || document.querySelector('[aria-modal="true"], [role="menu"]')) return
      const key = boardKey(e, e.key !== 'g' && now - lastG.current <= GO_TO_MS)
      if (key === null) return
      const { game: g, selection: sel, viewer: v } = latest.current
      const hover = hovered !== null && g.cards[hovered]?.zone === 'battlefield' ? hovered : null
      const targets = hover !== null ? (sel.has(hover) ? [...sel] : [hover]) : [...sel]
      e.preventDefault()
      switch (key) {
        case 'tap':
          if (targets.length > 0) play({ type: 'tap', ids: targets, tapped: tapTo(targets.map((i) => g.cards[i]!)) })
          break
        case 'flip':
          if (hover !== null && !g.cards[hover]!.faceDown && canFlip(g, hover)) play({ type: 'flip', id: hover })
          break
        case 'plus':
        case 'minus':
          if (targets.length > 0) play({ type: 'counter', ids: targets, name: '+1/+1', delta: key === 'plus' ? 1 : -1 })
          break
        case 'draw':
          play({ type: 'draw', seat: v, count: 1 })
          break
        case 'switch':
          switchSide()
          break
        case 'undo':
          undo()
          break
        case 'clear':
          setSelected(new Set())
          setAttaching(null)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hovered, play, undo, switchSide])

  const board: BoardApi = {
    game,
    setup,
    viewer,
    selection,
    hovered,
    setHovered,
    cardHeight: height,
    attaching,
    play,
    moveCards,
    playCard,
    beginCardDrag,
    beginBoxSelect,
    openCardMenu,
    openLibraryMenu,
    openFieldMenu,
    openStackMenu,
    openPile: (seat, zone) => setPile({ seat, zone }),
  }

  const top = twoSeats ? other(viewer) : null
  const rematchable = decks.data !== undefined && setup.seats.every((s) => decks.data.some((d) => d.id === s.deckId))

  return (
    <BoardContext value={board}>
      <div
        onPointerMove={(e) => {
          pointerX.current = e.clientX
        }}
        onContextMenu={(e) => e.preventDefault()}
        className="relative flex h-full flex-col gap-1.5 select-none"
      >
        {saveStatus === 'retrying' && (
          <p role="alert" className="absolute top-1 left-1/2 z-50 -translate-x-1/2 rounded-md bg-red-800 px-3 py-1 text-sm text-red-50 shadow-lg">
            Couldn't save — retrying
          </p>
        )}
        {attaching && (
          <p role="status" className="absolute top-1 left-1/2 z-50 -translate-x-1/2 rounded-md bg-amber-700 px-3 py-1 text-sm text-white shadow-lg">
            Click the card to attach {list(attaching.map((id) => nameFor(game, id, viewer)))} to (Esc cancels)
          </p>
        )}
        {top !== null && (
          <>
            <HandStrip seat={top} />
            <div className="flex min-h-0 flex-1 gap-1.5">
              <Battlefield seat={top} />
              <SideBlock seat={top} />
            </div>
          </>
        )}
        <TurnBar
          saveStatus={saveStatus}
          canUndo={canUndo}
          canSwitch={twoSeats}
          onUndo={undo}
          onLog={() => setLogOpen((open) => !open)}
          onSwitch={switchSide}
          onEnd={() => setDialog({ kind: 'end' })}
          onNextTurn={nextTurn}
        />
        <div className="flex min-h-0 flex-1 gap-1.5">
          <Battlefield seat={viewer} fieldRef={fieldRef} />
          <SideBlock seat={viewer} />
        </div>
        <HandStrip seat={viewer} />
      </div>

      <DragLayer store={dragStore} game={game} viewer={viewer} />
      {hovered !== null && !dragging && menu === null && <Preview id={hovered} pointerX={pointerX.current} />}
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      {pile && <PilePanel seat={pile.seat} zone={pile.zone} onClose={() => setPile(null)} />}
      {logOpen && <LogPanel actions={saved.actions} onClose={() => setLogOpen(false)} />}
      {dialog && (
        <DialogFor
          dialog={dialog}
          game={game}
          viewer={viewer}
          play={play}
          canRematch={rematchable}
          onRematch={() =>
            startGame.mutate({
              decks: [setup.seats[0]!.deckId, setup.seats[1]?.deckId ?? null],
              first: setup.startingSeat,
              life: setup.life,
              startingDraws: setup.startingDraws,
            })
          }
          onNewGame={() => endGame.mutate()}
          onClose={() => setDialog(null)}
        />
      )}
    </BoardContext>
  )
}

/** The drag in progress, told to the layer that draws it. */
function createDragStore() {
  let current: Drag | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set(next: Drag | null) {
      current = next
      for (const listener of listeners) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** The cards being dragged, following the pointer, or the box being drawn to select cards. */
function DragLayer({ store, game, viewer }: { store: ReturnType<typeof createDragStore>; game: GameState; viewer: SeatIndex }) {
  const drag = useSyncExternalStore(store.subscribe, store.get)
  if (drag === null || !drag.moved) return null
  if (drag.kind === 'box') {
    return (
      <div
        aria-hidden
        style={{
          left: Math.min(drag.start.x, drag.at.x),
          top: Math.min(drag.start.y, drag.at.y),
          width: Math.abs(drag.at.x - drag.start.x),
          height: Math.abs(drag.at.y - drag.start.y),
        }}
        className="pointer-events-none fixed z-50 rounded border border-amber-400 bg-amber-400/10"
      />
    )
  }
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50">
      {drag.ids.map((id) => {
        const o = drag.offsets[id]!
        const card = game.cards[id]
        if (!card) return null
        return (
          <div key={id} style={{ left: drag.at.x + o.dx, top: drag.at.y + o.dy }} className="absolute -translate-x-1/2 -translate-y-1/2 opacity-90">
            <CardView data={game.data[id]!} card={card} height={o.height} hidden={!visibleTo(card, viewer)} />
          </div>
        )
      })}
    </div>
  )
}

/** The dialog open on the board, wired to the game. */
function DialogFor({
  dialog,
  game,
  viewer,
  play,
  canRematch,
  onRematch,
  onNewGame,
  onClose,
}: {
  dialog: Dialog
  game: GameState
  viewer: SeatIndex
  play: (action: Action) => boolean
  canRematch: boolean
  onRematch: () => void
  onNewGame: () => void
  onClose: () => void
}) {
  switch (dialog.kind) {
    case 'count':
      return <CountDialog {...dialog} onClose={onClose} />
    case 'look':
      return (
        <LookDialog
          game={game}
          seat={dialog.seat}
          count={dialog.count}
          onSubmit={(placed) => play({ type: 'arrange', seat: dialog.seat, ...placed })}
          onClose={onClose}
        />
      )
    case 'search':
      return (
        <SearchDialog
          game={game}
          seat={dialog.seat}
          onSubmit={(ids, to, shuffle) => play({ type: 'search', seat: dialog.seat, ids, to, shuffle })}
          onClose={onClose}
        />
      )
    case 'counters':
      return (
        <CounterDialog
          names={list(dialog.ids.map((id) => nameFor(game, id, viewer)))}
          current={game.cards[dialog.ids[0]!]?.counters ?? {}}
          onAdd={(name, delta) => play({ type: 'counter', ids: dialog.ids, name, delta })}
          onSet={(name, value) => play({ type: 'setCounter', ids: dialog.ids, name, value })}
          onClose={onClose}
        />
      )
    case 'token':
      return <TokenDialog onSubmit={(token, count) => play({ type: 'token', seat: dialog.seat, token, count })} onClose={onClose} />
    case 'commander': {
      const others = dialog.ids.filter((id) => !dialog.commanders.includes(id))
      const place = dialog.to.zone === 'library' ? (dialog.to.at === 'top' ? 'Top of library' : 'Bottom of library') : PLACE_LABEL[dialog.to.zone]!
      return (
        <CommandZoneDialog
          names={list(dialog.commanders.map((id) => game.data[id]!.name))}
          placeLabel={place}
          onCommandZone={() => {
            play({ type: 'move', ids: dialog.commanders, to: { zone: 'command' } })
            if (others.length > 0) play({ type: 'move', ids: others, to: dialog.to })
          }}
          onPlace={() => play({ type: 'move', ids: dialog.ids, to: dialog.to })}
          onClose={onClose}
        />
      )
    }
    case 'end':
      return <EndGameDialog canRematch={canRematch} onRematch={onRematch} onNewGame={onNewGame} onClose={onClose} />
  }
}
