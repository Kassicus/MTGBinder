import type { Action, SavedGame, Setup } from '../../shared/playtest/types.ts'
import type { DB } from '../db/index.ts'

/** The playtest's one game in progress (spec §4.1, §5.9.1). */

/** The game in progress, or null when there's none. */
export function getSavedGame(db: DB): SavedGame | null {
  const game = db.prepare('SELECT setup, created_at FROM playtest_game WHERE id = 1').get() as
    | { setup: string; created_at: string }
    | undefined
  if (game === undefined) return null
  const actions = db.prepare('SELECT action FROM playtest_actions WHERE game_id = 1 ORDER BY seq').pluck().all() as string[]
  return { startedAt: game.created_at, setup: JSON.parse(game.setup) as Setup, actions: actions.map((a) => JSON.parse(a) as Action) }
}

/** When the game in progress started and how many actions it has, or null when there's none. */
export function gameProgress(db: DB): { startedAt: string; count: number } | null {
  const startedAt = db.prepare('SELECT created_at FROM playtest_game WHERE id = 1').pluck().get() as string | undefined
  if (startedAt === undefined) return null
  return { startedAt, count: db.prepare('SELECT count(*) FROM playtest_actions WHERE game_id = 1').pluck().get() as number }
}

/** Starts a game, replacing any in progress (its actions go with it), and answers when it started. */
export function saveNewGame(db: DB, setup: Setup, now = new Date()): string {
  const startedAt = now.toISOString()
  db.transaction(() => {
    db.prepare('DELETE FROM playtest_game').run()
    db.prepare('INSERT INTO playtest_game (id, setup, created_at) VALUES (1, ?, ?)').run(JSON.stringify(setup), startedAt)
  })()
  return startedAt
}

/** Saves an action at position `seq`, which the caller has checked is the next one. */
export function saveAction(db: DB, seq: number, action: Action, now = new Date()): void {
  db.prepare('INSERT INTO playtest_actions (game_id, seq, action, created_at) VALUES (1, ?, ?, ?)').run(
    seq,
    JSON.stringify(action),
    now.toISOString(),
  )
}

/** Removes the action at `seq`, which the caller has checked is the last one. */
export function deleteAction(db: DB, seq: number): void {
  db.prepare('DELETE FROM playtest_actions WHERE game_id = 1 AND seq = ?').run(seq)
}

/** Ends the game in progress, if there is one. */
export function deleteGame(db: DB): void {
  db.prepare('DELETE FROM playtest_game').run()
}
