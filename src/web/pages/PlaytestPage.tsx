import { useSearchParams } from 'react-router'
import type { SavedGame } from '../../shared/playtest/types.ts'
import { Board } from '../components/playtest/Board.tsx'
import { MulliganView } from '../components/playtest/MulliganView.tsx'
import { SetupView } from '../components/playtest/SetupView.tsx'
import { useEndGame, useGameSession, usePlaytestGame } from '../lib/playtest.ts'

/**
 * The Playtest page (spec §5.9): the game in progress, from its mulligans on, or a new game's setup. The deck
 * editor's Playtest opens the setup with that deck in seat 1 (`?deck=`).
 */
export function PlaytestPage() {
  const game = usePlaytestGame()
  const [params] = useSearchParams()
  const deckParam = params.get('deck')
  const presetDeck = deckParam !== null && /^[1-9]\d{0,14}$/.test(deckParam) ? Number(deckParam) : null

  if (game.isPending) return <p className="p-8 text-stone-400">Loading the game…</p>
  if (game.isError) {
    return (
      <p role="alert" className="p-8 text-red-300">
        Couldn't load the game: {game.error.message}
      </p>
    )
  }
  if (game.data === null || presetDeck !== null) return <SetupView key={presetDeck ?? 0} presetDeck={presetDeck} inProgress={game.data !== null} />
  return <GameView key={game.data.startedAt} saved={game.data} />
}

function GameView({ saved }: { saved: SavedGame }) {
  const session = useGameSession(saved)
  const endGame = useEndGame()
  const { game } = session
  if (game === null) {
    return (
      <div role="alert" className="mx-auto max-w-xl py-16 text-center text-stone-300">
        <p className="mb-4">{session.broken} This saved game can't be opened here.</p>
        <button onClick={() => endGame.mutate()} className="rounded-md border border-stone-700 bg-stone-800 px-4 py-2 text-stone-100 hover:bg-stone-700">
          End game
        </button>
      </div>
    )
  }
  if (game.phase === 'mulligan') {
    const seat = game.seats[game.choosing]!
    return <MulliganView key={`${game.choosing}:${seat.hand.join(',')}`} game={game} play={session.play} undo={session.undo} canUndo={session.canUndo} />
  }
  return <Board saved={saved} game={game} session={session} />
}
