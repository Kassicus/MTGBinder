import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { PlaytestError, replay } from '../../src/shared/playtest/game.ts'
import type { SavedGame } from '../../src/shared/playtest/types.ts'
import { gameOf, PLAYTEST_KEY, playAction } from '../../src/web/lib/playtest.ts'
import { setup } from '../helpers/playtest.ts'

/** The saved game the query holds: what the page renders and plays on. */
const held = (client: QueryClient) => client.getQueryData<SavedGame>(PLAYTEST_KEY)!

describe("the page's game", () => {
  it("shows a new game's board even when the query keeps the old game's empty list", () => {
    const client = new QueryClient()
    client.setQueryData<SavedGame>(PLAYTEST_KEY, { startedAt: 'A', setup: setup({ seed: 1 }), actions: [] })
    const first = gameOf(held(client))
    const oldList = held(client).actions
    client.setQueryData<SavedGame>(PLAYTEST_KEY, { startedAt: 'B', setup: setup({ seed: 2 }), actions: [] })
    // The query keeps the old list in place of an equal new one.
    expect(held(client).actions).toBe(oldList)
    const second = gameOf(held(client))
    expect(second).toEqual(replay(setup({ seed: 2 }), []))
    expect(second.seats[0]!.library).not.toEqual(first.seats[0]!.library)
  })

  it('keeps the game a played action makes, for the list the query stores', () => {
    const client = new QueryClient()
    client.setQueryData<SavedGame>(PLAYTEST_KEY, { startedAt: 'A', setup: setup(), actions: [] })
    const next = playAction(client, held(client), { type: 'mulligan', seat: 0 })
    expect(held(client).actions).toEqual([{ type: 'mulligan', seat: 0 }])
    expect(gameOf(held(client))).toBe(next)
    const after = playAction(client, held(client), { type: 'mulligan', seat: 0 })
    expect(gameOf(held(client))).toBe(after)
    expect(after.mulligans).toBe(2)
  })

  it("stores nothing for an action that doesn't apply", () => {
    const client = new QueryClient()
    client.setQueryData<SavedGame>(PLAYTEST_KEY, { startedAt: 'A', setup: setup(), actions: [] })
    const before = held(client)
    expect(() => playAction(client, before, { type: 'mulligan', seat: 1 })).toThrow(PlaytestError)
    expect(held(client)).toBe(before)
  })
})
