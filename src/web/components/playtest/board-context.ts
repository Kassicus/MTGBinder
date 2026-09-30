import { createContext, useContext, type MouseEvent, type PointerEvent } from 'react'
import type { Action, Dest, GameState, SeatIndex, Setup } from '../../../shared/playtest/types.ts'

/** Where a drag started, which decides what a click without a drag does. */
export type DragSource = 'battlefield' | 'hand' | 'command' | 'stack' | 'pile'

/** What the table's parts read and do (spec §5.9.3, §5.9.4); the Board provides it. */
export interface BoardApi {
  game: GameState
  setup: Setup
  /** The seat at the bottom of the window. */
  viewer: SeatIndex
  selection: ReadonlySet<string>
  hovered: string | null
  setHovered: (id: string | null) => void
  /** Height of a card on the battlefield, in pixels. */
  cardHeight: number
  /** A card being attached waits for its host to be clicked. */
  attaching: string[] | null
  play: (action: Action) => boolean
  /** Moves cards, first asking "Command zone instead?" for a commander going somewhere it may skip. */
  moveCards: (ids: string[], to: Dest) => void
  /** A double-click: a permanent to the battlefield, an instant or sorcery onto the stack. */
  playCard: (id: string) => void
  beginCardDrag: (e: PointerEvent, id: string, source: DragSource) => void
  beginBoxSelect: (e: PointerEvent, seat: SeatIndex) => void
  openCardMenu: (e: MouseEvent, id: string) => void
  openLibraryMenu: (e: MouseEvent, seat: SeatIndex) => void
  openFieldMenu: (e: MouseEvent, seat: SeatIndex) => void
  openStackMenu: (e: MouseEvent, item: string) => void
  openPile: (seat: SeatIndex, zone: 'graveyard' | 'exile') => void
}

export const BoardContext = createContext<BoardApi | null>(null)

export function useBoard(): BoardApi {
  const board = useContext(BoardContext)
  if (!board) throw new Error('useBoard must be used inside the Board')
  return board
}
