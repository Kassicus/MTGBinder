import { describe, expect, it } from 'vitest'
import type { CardState } from '../../src/shared/playtest/types.ts'
import {
  asksCommandZone,
  boardKey,
  cardHeight,
  cardsInBox,
  counterTag,
  fromScreen,
  playDest,
  startingLife,
  tapTo,
  toScreen,
} from '../../src/web/lib/playtest-board.ts'

function card(id: string, extra: Partial<CardState> = {}): CardState {
  return {
    id,
    owner: 0,
    controller: 0,
    zone: 'battlefield',
    commander: false,
    token: false,
    tapped: false,
    faceDown: false,
    face: 0,
    counters: {},
    attachedTo: null,
    pos: { x: 0.5, y: 0.5 },
    ...extra,
  }
}

const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})

describe('the board', () => {
  it('draws the bottom half with its edge at the bottom and the top half flipped', () => {
    const box = { width: 1000, height: 400 }
    expect(toScreen({ x: 0.1, y: 0.2 }, box, false)).toEqual({ x: 100, y: 320 })
    expect(toScreen({ x: 0.1, y: 0.2 }, box, true)).toEqual({ x: 100, y: 80 })
    expect(fromScreen({ x: 100, y: 320 }, box, false)).toEqual({ x: 0.1, y: 0.2 })
    expect(fromScreen({ x: 100, y: 80 }, box, true)).toEqual({ x: 0.1, y: 0.2 })
    expect(fromScreen({ x: -50, y: 900 }, box, false)).toEqual({ x: 0.03, y: 0.03 })
  })

  it('sizes cards to the half, within bounds', () => {
    expect(cardHeight(400)).toBe(120)
    expect(cardHeight(100)).toBe(56)
    expect(cardHeight(1000)).toBe(150)
  })

  it('finds the cards whose centers are in a dragged box', () => {
    const field = { width: 1000, height: 400 }
    const cards = [card('a', { pos: { x: 0.1, y: 0.5 } }), card('b', { pos: { x: 0.5, y: 0.5 } }), card('c', { pos: null })]
    expect(cardsInBox(cards, { left: 0, top: 0, right: 300, bottom: 400 }, field, false)).toEqual(['a'])
    expect(cardsInBox(cards, { left: 0, top: 150, right: 600, bottom: 250 }, field, true)).toEqual(['a', 'b'])
  })

  it('starts at 40 life when either deck is a Commander deck, else 20', () => {
    expect(startingLife(['commander', 'modern'])).toBe(40)
    expect(startingLife(['modern'])).toBe(20)
  })

  it('plays permanents to the battlefield and instants and sorceries onto the stack', () => {
    expect(playDest('creature', 1)).toEqual({ zone: 'battlefield', seat: 1 })
    expect(playDest('land', 0)).toEqual({ zone: 'battlefield', seat: 0 })
    expect(playDest('spell', 0)).toEqual({ zone: 'stack' })
  })

  it('taps a selection unless all of it is tapped', () => {
    expect(tapTo([card('a'), card('b', { tapped: true })])).toBe(true)
    expect(tapTo([card('a', { tapped: true }), card('b', { tapped: true })])).toBe(false)
  })

  it('asks "Command zone instead?" when a commander goes to a graveyard, exile, a hand, or a library', () => {
    const commander = card('c', { commander: true })
    for (const zone of ['graveyard', 'exile', 'hand'] as const) expect(asksCommandZone(commander, { zone })).toBe(true)
    expect(asksCommandZone(commander, { zone: 'library', at: 'bottom' })).toBe(true)
    expect(asksCommandZone(commander, { zone: 'battlefield', seat: 1 })).toBe(false)
    expect(asksCommandZone(card('x'), { zone: 'graveyard' })).toBe(false)
  })

  it("doesn't ask for a commander that's in the command zone already", () => {
    expect(asksCommandZone(card('c', { commander: true, zone: 'command', pos: null }), { zone: 'graveyard' })).toBe(false)
  })

  it('shortens common counters', () => {
    expect(counterTag('+1/+1', 3)).toBe('+3/+3')
    expect(counterTag('-1/-1', 1)).toBe('−1/−1')
    expect(counterTag('loyalty', 4)).toBe('◆4')
    expect(counterTag('charge', 2)).toBe('charge 2')
  })

  it("reads the board's keys, and none right after a g", () => {
    expect(boardKey(key('t'), false)).toBe('tap')
    expect(boardKey(key('='), false)).toBe('plus')
    expect(boardKey(key('Tab'), false)).toBe('switch')
    expect(boardKey(key('Tab', { shiftKey: true }), false)).toBeNull()
    expect(boardKey(key('z', { metaKey: true }), false)).toBe('undo')
    expect(boardKey(key('z', { metaKey: true, shiftKey: true }), false)).toBeNull()
    expect(boardKey(key('d', { ctrlKey: true }), false)).toBeNull()
    expect(boardKey(key('d'), true)).toBeNull()
    expect(boardKey(key('x'), false)).toBeNull()
  })
})
