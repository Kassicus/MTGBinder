import type { ScryfallErrorBody } from './types.ts'

export const USER_AGENT = 'Binder/0.1 (personal)'
const RETRY_DELAYS_MS = [1000, 2000, 4000]
/** After giving up on a 429, later requests wait this long, so they don't meet the rate limit at once. */
export const GIVE_UP_PAUSE_MS = 8000

export type ScryfallErrorCode = 'offline' | 'not_found' | 'rate_limited' | 'http'

export class ScryfallError extends Error {
  code: ScryfallErrorCode
  status: number | null
  /** Parts of a search query Scryfall ignored (it sends these with 400 "all terms ignored" errors). */
  warnings: string[]
  constructor(code: ScryfallErrorCode, status: number | null, message: string, options: { warnings?: string[]; cause?: unknown } = {}) {
    super(message, { cause: options.cause })
    this.name = 'ScryfallError'
    this.code = code
    this.status = status
    this.warnings = options.warnings ?? []
  }
}

export interface ScryfallClient {
  /** GET an API path (e.g. `/cards/search?q=...`) or absolute URL and parse the JSON response. */
  getJson<T>(pathOrUrl: string): Promise<T>
  /** POST a JSON body and parse the JSON response. */
  postJson<T>(pathOrUrl: string, body: unknown): Promise<T>
  /** GET a file (bulk data). Resolves with the successful Response; rejects on any non-2xx. */
  download(url: string): Promise<Response>
}

export interface ScryfallClientOptions {
  baseUrl?: string
  fetch?: (url: string, init: RequestInit) => Promise<Response>
  sleep?: (ms: number) => Promise<void>
  /** Monotonic milliseconds; defaults to performance.now so wall-clock changes can't stall the queue. */
  now?: () => number
  minIntervalMs?: number
  /** Abort an API request (including reading its body) after this long. Default 30 s. */
  timeoutMs?: number
  /** Abort a file download when nothing arrives for this long. Default 60 s. */
  downloadIdleMs?: number
  /** Abort a file download after this long in all, however steadily it arrives. Default 30 minutes. */
  downloadTimeoutMs?: number
}

/** "fetch failed (ECONNREFUSED)": undici puts the real reason in `cause`. */
function describeFailure(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const cause = err.cause as { code?: unknown; message?: unknown } | undefined
  const detail = typeof cause?.code === 'string' ? cause.code : typeof cause?.message === 'string' ? cause.message : null
  return detail ? `${err.message} (${detail})` : err.message
}

function toTransportError(err: unknown): ScryfallError {
  if (err instanceof ScryfallError) return err // a stalled download, stopped with its own reason
  if (err instanceof Error && err.name === 'TimeoutError') {
    return new ScryfallError('offline', null, "Scryfall didn't respond in time", { cause: err })
  }
  return new ScryfallError('offline', null, `Scryfall is unreachable: ${describeFailure(err)}`, { cause: err })
}

export function createScryfallClient(options: ScryfallClientOptions = {}): ScryfallClient {
  const baseUrl = options.baseUrl ?? 'https://api.scryfall.com'
  const doFetch = options.fetch ?? ((url, init) => fetch(url, init))
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const now = options.now ?? (() => performance.now())
  const minIntervalMs = options.minIntervalMs ?? 100
  const timeoutMs = options.timeoutMs ?? 30_000
  const downloadIdleMs = options.downloadIdleMs ?? 60_000
  const downloadTimeoutMs = options.downloadTimeoutMs ?? 1_800_000

  // Requests start one at a time, at least minIntervalMs apart (Scryfall asks for 50–100 ms between calls).
  // After a 429 every request waits until the backoff ends, not just the one that was refused.
  let queue: Promise<void> = Promise.resolve()
  let lastStart = Number.NEGATIVE_INFINITY
  let pausedUntil = Number.NEGATIVE_INFINITY
  function waitForSlot(): Promise<void> {
    const slot = queue.then(async () => {
      for (;;) {
        const wait = Math.max(lastStart + minIntervalMs, pausedUntil) - now()
        if (wait <= 0) break
        await sleep(wait) // re-check afterwards: a 429 may have extended the pause meanwhile
      }
      lastStart = now()
    })
    queue = slot
    return slot
  }

  const toUrl = (pathOrUrl: string) => (/^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${baseUrl}${pathOrUrl}`)

  async function send(pathOrUrl: string, init: RequestInit, accept: string, timeout: number): Promise<Response> {
    const url = toUrl(pathOrUrl)
    const headers = { 'User-Agent': USER_AGENT, Accept: accept, ...(init.headers as Record<string, string> | undefined) }
    for (let attempt = 0; ; attempt++) {
      await waitForSlot()
      let res: Response
      const timer = AbortSignal.timeout(timeout)
      try {
        res = await doFetch(url, { ...init, headers, signal: init.signal ? AbortSignal.any([init.signal, timer]) : timer })
      } catch (err) {
        throw toTransportError(err)
      }
      if (res.status !== 429) return res
      await res.body?.cancel().catch(() => {})
      const delay = RETRY_DELAYS_MS[attempt]
      if (delay === undefined) {
        pausedUntil = Math.max(pausedUntil, now() + GIVE_UP_PAUSE_MS)
        throw new ScryfallError('rate_limited', 429, 'Scryfall rate limit exceeded; try again in a minute')
      }
      pausedUntil = Math.max(pausedUntil, now() + delay)
    }
  }

  async function parse<T>(res: Response): Promise<T> {
    let text: string
    try {
      text = await res.text()
    } catch (err) {
      throw toTransportError(err) // the connection dropped or timed out mid-body
    }
    if (res.ok) {
      try {
        return JSON.parse(text) as T
      } catch (err) {
        throw new ScryfallError('http', res.status, "Scryfall sent a response that isn't JSON", { cause: err })
      }
    }
    let body: Partial<ScryfallErrorBody> & { warnings?: unknown } = {}
    try {
      body = JSON.parse(text) as typeof body
    } catch {
      // The error body wasn't JSON; keep the status message.
    }
    const warnings = Array.isArray(body.warnings) ? body.warnings.filter((w): w is string => typeof w === 'string') : []
    const message = typeof body.details === 'string' ? body.details : `HTTP ${res.status}`
    throw new ScryfallError(res.status === 404 ? 'not_found' : 'http', res.status, message, { warnings })
  }

  return {
    async getJson<T>(pathOrUrl: string) {
      return parse<T>(await send(pathOrUrl, { method: 'GET' }, 'application/json', timeoutMs))
    },
    async postJson<T>(pathOrUrl: string, body: unknown) {
      const init: RequestInit = { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
      return parse<T>(await send(pathOrUrl, init, 'application/json', timeoutMs))
    },
    async download(url: string) {
      // A download may take a while on a slow connection, but one that stops arriving is stopped: after
      // downloadIdleMs with nothing new (before the response, or between its chunks), and after downloadTimeoutMs in all.
      const stop = new AbortController()
      let watched: TransformStreamDefaultController<Uint8Array> | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      const watch = () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          const reason = new ScryfallError('offline', null, 'The download stalled: Scryfall stopped sending data')
          watched?.error(reason)
          stop.abort(reason)
        }, downloadIdleMs)
        timer.unref?.()
      }
      watch()
      let res: Response
      try {
        res = await send(url, { method: 'GET', signal: stop.signal }, '*/*', downloadTimeoutMs)
      } catch (err) {
        clearTimeout(timer)
        throw err
      }
      if (!res.ok) {
        clearTimeout(timer)
        await res.body?.cancel().catch(() => {})
        throw new ScryfallError(res.status === 404 ? 'not_found' : 'http', res.status, `Download failed with HTTP ${res.status}`)
      }
      const body = res.body?.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          start: (c) => void (watched = c),
          transform(chunk, c) {
            watch()
            c.enqueue(chunk)
          },
          flush: () => clearTimeout(timer),
        }),
      )
      if (!body) clearTimeout(timer)
      return new Response(body ?? null, { status: res.status, statusText: res.statusText, headers: res.headers })
    },
  }
}
