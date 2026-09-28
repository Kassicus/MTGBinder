import { describe, expect, it, vi } from 'vitest'
import { createScryfallClient, GIVE_UP_PAUSE_MS, ScryfallError, USER_AGENT } from '../../src/server/scryfall/client.ts'

function fakeClock() {
  let t = 0
  const sleeps: number[] = []
  return {
    sleeps,
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      t += ms
    },
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function setup(responses: Array<Response | Error>) {
  const clock = fakeClock()
  const fetch = vi.fn(async (_url: string, _init: RequestInit): Promise<Response> => {
    const next = responses.shift()
    if (!next) throw new Error('unexpected extra request')
    if (next instanceof Error) throw next
    return next
  })
  return { clock, fetch, client: createScryfallClient({ fetch, now: clock.now, sleep: clock.sleep }) }
}

describe('scryfall client', () => {
  it('sends the required headers to the API base URL', async () => {
    const { fetch, client } = setup([json({ ok: true })])
    await expect(client.getJson('/cards/named?exact=bolt')).resolves.toEqual({ ok: true })
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('https://api.scryfall.com/cards/named?exact=bolt')
    expect(init?.headers).toMatchObject({ 'User-Agent': USER_AGENT, Accept: 'application/json' })
  })

  it('uses absolute URLs as given', async () => {
    const { fetch, client } = setup([new Response('file')])
    await client.download('https://data.scryfall.io/default-cards/x.jsonl.gz')
    expect(fetch.mock.calls[0]?.[0]).toBe('https://data.scryfall.io/default-cards/x.jsonl.gz')
    expect(fetch.mock.calls[0]?.[1].headers).toMatchObject({ 'User-Agent': USER_AGENT, Accept: '*/*' })
  })

  it('spaces request starts at least 100 ms apart', async () => {
    const { clock, client } = setup([json(1), json(2), json(3)])
    await Promise.all([client.getJson('/a'), client.getJson('/b'), client.getJson('/c')])
    expect(clock.sleeps).toEqual([100, 100])
  })

  it('retries a 429 after backing off', async () => {
    const { clock, fetch, client } = setup([json({}, 429), json({ ok: 1 })])
    await expect(client.getJson('/x')).resolves.toEqual({ ok: 1 })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(clock.sleeps).toEqual([1000])
  })

  it('gives up after three retries of 429', async () => {
    const { clock, fetch, client } = setup([json({}, 429), json({}, 429), json({}, 429), json({}, 429)])
    const err = await client.getJson('/x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ScryfallError)
    expect(err).toMatchObject({ code: 'rate_limited', status: 429 })
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(clock.sleeps).toEqual([1000, 2000, 4000])
  })

  it('makes later requests wait after giving up on a 429, so they do not meet the rate limit at once', async () => {
    const { clock, client } = setup([json({}, 429), json({}, 429), json({}, 429), json({}, 429), json({ ok: 1 })])
    await client.getJson('/x').catch(() => {})
    clock.sleeps.length = 0
    await expect(client.getJson('/y')).resolves.toEqual({ ok: 1 })
    expect(clock.sleeps).toEqual([GIVE_UP_PAUSE_MS])
  })

  it('reports network failures as offline', async () => {
    const { client } = setup([new TypeError('fetch failed')])
    await expect(client.getJson('/x')).rejects.toMatchObject({ code: 'offline', status: null, message: 'Scryfall is unreachable: fetch failed' })
  })

  it('uses Scryfall error details for 404s', async () => {
    const { client } = setup([json({ object: 'error', status: 404, code: 'not_found', details: 'No card found' }, 404)])
    await expect(client.getJson('/cards/named?exact=zzz')).rejects.toMatchObject({ code: 'not_found', status: 404, message: 'No card found' })
  })

  it('falls back to the status when an error body is not JSON', async () => {
    const { client } = setup([new Response('<html>oops</html>', { status: 500 })])
    await expect(client.getJson('/x')).rejects.toMatchObject({ code: 'http', status: 500, message: 'HTTP 500' })
  })

  it('posts JSON bodies', async () => {
    const { fetch, client } = setup([json({ data: [] })])
    await client.postJson('/cards/collection', { identifiers: [] })
    const init = fetch.mock.calls[0]?.[1]
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe('{"identifiers":[]}')
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json', 'User-Agent': USER_AGENT })
  })

  it('rejects failed downloads', async () => {
    const { client } = setup([new Response('gone', { status: 404 })])
    await expect(client.download('https://data.scryfall.io/x')).rejects.toMatchObject({ code: 'not_found', status: 404 })
  })
})

describe('scryfall client: hardening', () => {
  it('pauses a request already waiting in the queue when another request hits a 429', async () => {
    // A clock whose sleeps only finish when the test advances time, so the order of events is exact.
    let t = 0
    const timers: Array<{ at: number; resolve: () => void }> = []
    const settle = () => new Promise<void>((resolve) => setImmediate(resolve))
    const advanceTo = async (target: number) => {
      t = target
      for (const timer of timers.filter((x) => x.at <= t)) {
        timers.splice(timers.indexOf(timer), 1)
        timer.resolve()
      }
      await settle()
    }
    const starts: Array<[string, number]> = []
    const responses = [json({}, 429), json({ b: 1 }), json({ a: 1 })]
    const fetch = vi.fn(async (url: string): Promise<Response> => {
      starts.push([url.slice(-2), t])
      return responses.shift()!
    })
    const client = createScryfallClient({
      fetch,
      now: () => t,
      sleep: (ms) => new Promise<void>((resolve) => timers.push({ at: t + ms, resolve })),
    })
    const both = Promise.all([client.getJson('/a'), client.getJson('/b')])
    await settle() // /a starts at 0 and is refused: pause until 1000. /b is already waiting for its 100 ms slot.
    await advanceTo(100) // /b wakes, sees the pause, and keeps waiting
    expect(starts).toEqual([['/a', 0]])
    await advanceTo(1000) // pause over: /b starts
    await advanceTo(1100) // /a retries 100 ms later
    expect(await both).toEqual([{ a: 1 }, { b: 1 }])
    expect(starts).toEqual([['/a', 0], ['/b', 1000], ['/a', 1100]])
  })

  it('cancels the body of a refused response before retrying', async () => {
    const refused = json({}, 429)
    const cancel = vi.spyOn(refused.body!, 'cancel')
    const { client } = setup([refused, json({ ok: 1 })])
    await client.getJson('/x')
    expect(cancel).toHaveBeenCalled()
  })

  it('keeps the underlying cause of a network failure', async () => {
    const failure = new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) })
    const { client } = setup([failure])
    const err = await client.getJson('/x').catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'offline', message: 'Scryfall is unreachable: fetch failed (ECONNREFUSED)' })
    expect((err as Error).cause).toBe(failure)
  })

  it('reports a timeout as offline', async () => {
    const { client } = setup([new DOMException('The operation was aborted due to timeout', 'TimeoutError')])
    await expect(client.getJson('/x')).rejects.toMatchObject({ code: 'offline', message: "Scryfall didn't respond in time" })
  })

  it('passes a timeout signal to every request', async () => {
    const { fetch, client } = setup([json({})])
    await client.getJson('/x')
    expect(fetch.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal)
  })

  it('reports a connection that drops mid-body as offline', async () => {
    const broken = new Response(new ReadableStream({ start: (c) => c.error(new TypeError('terminated')) }), { status: 200 })
    const { client } = setup([broken])
    await expect(client.getJson('/x')).rejects.toMatchObject({ code: 'offline', message: 'Scryfall is unreachable: terminated' })
  })

  it('reports a 2xx that is not JSON as an http error', async () => {
    const { client } = setup([new Response('<html>captive portal</html>', { status: 200 })])
    await expect(client.getJson('/x')).rejects.toMatchObject({ code: 'http', status: 200, message: "Scryfall sent a response that isn't JSON" })
  })

  it('keeps Scryfall query warnings on a 400', async () => {
    const { client } = setup([
      json({ object: 'error', status: 400, code: 'bad_request', details: 'All of your terms were ignored.', warnings: ['Unknown keyword "foo".'] }, 400),
    ])
    await expect(client.getJson('/cards/search?q=foo:bar')).rejects.toMatchObject({
      code: 'http', status: 400, message: 'All of your terms were ignored.', warnings: ['Unknown keyword "foo".'],
    })
  })

  it('falls back to the status when an error JSON has no details', async () => {
    const { client } = setup([json({ object: 'error' }, 503)])
    await expect(client.getJson('/x')).rejects.toMatchObject({ code: 'http', status: 503, message: 'HTTP 503' })
  })

  it('reports postJson errors like getJson', async () => {
    const { client } = setup([json({ object: 'error', status: 422, code: 'x', details: 'Too many identifiers' }, 422)])
    await expect(client.postJson('/cards/collection', {})).rejects.toMatchObject({ code: 'http', status: 422, message: 'Too many identifiers' })
  })

  it('reports non-404 download failures as http errors and retries a 429 on downloads', async () => {
    const failed = setup([new Response('nope', { status: 500 })])
    await expect(failed.client.download('https://data.scryfall.io/x')).rejects.toMatchObject({ code: 'http', status: 500 })
    const limited = setup([json({}, 429), new Response('file')])
    await expect(limited.client.download('https://data.scryfall.io/x').then((r) => r.text())).resolves.toBe('file')
  })

  it('follows absolute URLs through getJson (pagination) and honors baseUrl and minIntervalMs', async () => {
    const clock = fakeClock()
    const urls: string[] = []
    const fetch = vi.fn(async (url: string) => {
      urls.push(url)
      return json({})
    })
    const client = createScryfallClient({ fetch, now: clock.now, sleep: clock.sleep, baseUrl: 'http://test', minIntervalMs: 250 })
    await Promise.all([client.getJson('/a'), client.getJson('https://api.scryfall.com/cards/search?page=2')])
    expect(urls).toEqual(['http://test/a', 'https://api.scryfall.com/cards/search?page=2'])
    expect(clock.sleeps).toEqual([250])
  })

  it('never shortens a pause when a shorter backoff arrives after a longer one', async () => {
    // Same hand-driven clock as above; fetches stay in flight until the test responds to them.
    let t = 0
    const timers: Array<{ at: number; resolve: () => void }> = []
    const settle = () => new Promise<void>((resolve) => setImmediate(resolve))
    const advanceTo = async (target: number) => {
      t = target
      for (const timer of timers.filter((x) => x.at <= t)) {
        timers.splice(timers.indexOf(timer), 1)
        timer.resolve()
      }
      await settle()
    }
    const starts: Array<[string, number]> = []
    const inFlight = new Map<string, (res: Response) => void>()
    const fetch = vi.fn((url: string): Promise<Response> => {
      starts.push([url.slice(-2), t])
      return new Promise<Response>((resolve) => inFlight.set(url.slice(-2), resolve))
    })
    const respond = async (path: string, res: Response) => {
      inFlight.get(path)!(res)
      inFlight.delete(path)
      await settle()
    }
    const client = createScryfallClient({
      fetch,
      now: () => t,
      sleep: (ms) => new Promise<void>((resolve) => timers.push({ at: t + ms, resolve })),
    })
    const ab = Promise.all([client.getJson('/a'), client.getJson('/b')])
    await settle() // /a starts at 0
    await respond('/a', json({}, 429)) // /a's 1st refusal: pause until 1000
    await advanceTo(1000) // /b starts (its 1st attempt) and stays in flight
    await advanceTo(1100) // /a retries (its 2nd attempt) and stays in flight
    const c = client.getJson('/c') // /c waits for its 100 ms slot at 1200
    await settle()
    await respond('/a', json({}, 429)) // /a's 2nd refusal at 1100: pause until 3100
    await advanceTo(1150)
    await respond('/b', json({}, 429)) // /b's 1st refusal at 1150 backs off only to 2150: the pause must stay 3100
    await advanceTo(1200) // /c wakes, sees the pause, and keeps waiting
    await advanceTo(2150)
    expect(starts).toEqual([['/a', 0], ['/b', 1000], ['/a', 1100]])
    await advanceTo(3100) // pause over: /c starts
    await respond('/c', json({ c: 1 }))
    await advanceTo(3200) // then /a
    await respond('/a', json({ a: 1 }))
    await advanceTo(3300) // then /b
    await respond('/b', json({ b: 1 }))
    expect(await ab).toEqual([{ a: 1 }, { b: 1 }])
    expect(await c).toEqual({ c: 1 })
    expect(starts).toEqual([['/a', 0], ['/b', 1000], ['/a', 1100], ['/c', 3100], ['/a', 3200], ['/b', 3300]])
  })

  it('retries a 429 whose body stream already failed', async () => {
    const refused = new Response(new ReadableStream({ start: (c) => c.error(new TypeError('terminated')) }), { status: 429 })
    const { client } = setup([refused, json({ ok: 1 })])
    await expect(client.getJson('/x')).resolves.toEqual({ ok: 1 })
  })

  it('reports a failed download as an http error even when its body stream already failed', async () => {
    const failed = new Response(new ReadableStream({ start: (c) => c.error(new TypeError('terminated')) }), { status: 500 })
    const { client } = setup([failed])
    await expect(client.download('https://data.scryfall.io/x')).rejects.toMatchObject({ code: 'http', status: 500 })
  })
})

describe('scryfall client: downloads that stall', () => {
  /** A download whose body sends `chunks` bytes, one every `everyMs`, then stops arriving (or ends, with `end`). */
  function trickle(chunks: number, everyMs: number, end: boolean) {
    let sent = 0
    return new ReadableStream<Uint8Array>({
      async pull(c) {
        if (sent === chunks) {
          if (end) c.close()
          return new Promise(() => {}) // nothing more arrives
        }
        await new Promise((resolve) => setTimeout(resolve, everyMs))
        sent++
        c.enqueue(new Uint8Array([sent]))
      },
    })
  }

  function downloader(body: ReadableStream<Uint8Array>) {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(body))
    return { fetch, client: createScryfallClient({ fetch, minIntervalMs: 0, downloadIdleMs: 60 }) }
  }

  it('stops a download when nothing arrives for a while, saying why, and stops the request too', async () => {
    const { fetch, client } = downloader(trickle(2, 5, false))
    const res = await client.download('https://data.scryfall.io/x.jsonl.gz')
    const err = await res.arrayBuffer().catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'offline', message: 'The download stalled: Scryfall stopped sending data' })
    expect(fetch.mock.calls[0]?.[1].signal?.aborted).toBe(true)
  })

  it('lets a slow but steady download finish, however long it takes in all', async () => {
    const { client } = downloader(trickle(8, 30, true))
    const res = await client.download('https://data.scryfall.io/x.jsonl.gz')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
  })
})
