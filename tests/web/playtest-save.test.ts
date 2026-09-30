import { describe, expect, it } from 'vitest'
import { ApiRequestError } from '../../src/web/lib/api.ts'
import { createSaver, retryDelay, type SaveOp } from '../../src/web/lib/playtest-save.ts'

/** A server the test answers by hand: each send waits until the test settles it. */
function fakeServer() {
  const sent: SaveOp[] = []
  const waiting: Array<{ resolve: () => void; reject: (err: unknown) => void }> = []
  const waits: number[] = []
  const refused: ApiRequestError[] = []
  let wake: (() => void) | null = null
  const saver = createSaver({
    send: (op) => {
      sent.push(op)
      return new Promise<void>((resolve, reject) => waiting.push({ resolve, reject }))
    },
    wait: (ms) => {
      waits.push(ms)
      return new Promise<void>((resolve) => (wake = resolve))
    },
    onRefused: (err) => refused.push(err),
  })
  const tick = () => new Promise((r) => setTimeout(r, 0))
  return {
    saver,
    sent,
    waits,
    refused,
    /** Answers the oldest send. */
    async ok() {
      waiting.shift()!.resolve()
      await tick()
    },
    async fail(err: unknown) {
      waiting.shift()!.reject(err)
      await tick()
    },
    async retry() {
      wake!()
      await tick()
    },
  }
}

const nextTurn = { type: 'nextTurn' } as const
const seqs = (ops: SaveOp[]) => ops.map((op) => `${op.kind} ${op.seq}`)

describe('saving actions', () => {
  it('sends one at a time, in order', async () => {
    const s = fakeServer()
    s.saver.append('g', 0, nextTurn)
    s.saver.append('g', 1, nextTurn)
    expect(seqs(s.sent)).toEqual(['append 0'])
    expect(s.saver.status()).toBe('saving')
    await s.ok()
    expect(seqs(s.sent)).toEqual(['append 0', 'append 1'])
    await s.ok()
    expect(s.saver.status()).toBe('saved')
  })

  it("tries again while the server can't be reached, waiting longer each time, and keeps later actions in line", async () => {
    const s = fakeServer()
    s.saver.append('g', 0, nextTurn)
    await s.fail(new TypeError('Failed to fetch'))
    expect(s.saver.status()).toBe('retrying')
    s.saver.append('g', 1, nextTurn)
    await s.retry()
    await s.fail(new ApiRequestError(503, 'http_error', 'Request failed (503)'))
    await s.retry()
    expect(s.waits).toEqual([1000, 2000])
    expect(seqs(s.sent)).toEqual(['append 0', 'append 0', 'append 0'])
    await s.ok()
    expect(s.saver.status()).toBe('saving')
    await s.ok()
    expect(seqs(s.sent)).toEqual(['append 0', 'append 0', 'append 0', 'append 1'])
    expect(s.saver.status()).toBe('saved')
    expect([0, 1, 2, 3, 4, 5, 6].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000])
  })

  it('drops everything after a save the server refuses, and says so', async () => {
    const s = fakeServer()
    s.saver.append('g', 0, nextTurn)
    s.saver.append('g', 1, nextTurn)
    await s.fail(new ApiRequestError(409, 'conflict', 'The game changed in another window'))
    expect(s.refused.map((e) => e.status)).toEqual([409])
    expect(seqs(s.sent)).toEqual(['append 0'])
    expect(s.saver.status()).toBe('saved')
  })

  it('takes back an action not yet sent by dropping it, and one already sent by undoing it', async () => {
    const s = fakeServer()
    s.saver.append('g', 0, nextTurn)
    s.saver.append('g', 1, nextTurn)
    s.saver.undo('g', 1)
    s.saver.undo('g', 0)
    await s.ok()
    await s.ok()
    expect(seqs(s.sent)).toEqual(['append 0', 'undo 0'])
    s.saver.undo('g', 5)
    expect(seqs(s.sent)).toEqual(['append 0', 'undo 0', 'undo 5'])
  })

  it('ignores what the server says about a save dropped while it was sent', async () => {
    const s = fakeServer()
    s.saver.append('old', 3, nextTurn)
    s.saver.reset()
    s.saver.append('new', 0, nextTurn)
    await s.fail(new ApiRequestError(409, 'conflict', 'The game changed in another window'))
    expect(s.refused).toEqual([])
    expect(seqs(s.sent)).toEqual(['append 3', 'append 0'])
    await s.ok()
    expect(s.saver.status()).toBe('saved')
  })

  it('tells listeners when the status changes', async () => {
    const s = fakeServer()
    const seen: string[] = []
    const stop = s.saver.subscribe(() => seen.push(s.saver.status()))
    s.saver.append('g', 0, nextTurn)
    await s.ok()
    stop()
    s.saver.append('g', 1, nextTurn)
    expect(seen).toEqual(['saving', 'saved'])
  })
})
