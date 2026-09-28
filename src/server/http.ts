import type { MiddlewareHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import type { Span } from '../shared/search/ast.ts'

/** An error with an HTTP status, rendered as `{ error: { code, message } }` by the app's error handler. */
export class ApiError extends Error {
  status: ContentfulStatusCode
  code: string
  /** For query errors: the part of the query that's wrong. */
  span: Span | undefined
  constructor(status: ContentfulStatusCode, code: string, message: string, span?: Span) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.span = span
  }
}

/** Validates input with a zod schema; throws a 400 ApiError listing every problem. */
export function parseWith<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  const message = result.error.issues.map((i) => `${i.path.map(String).join('.') || 'input'}: ${i.message}`).join('; ')
  throw new ApiError(400, 'bad_request', message)
}

/** Reads a JSON request body, answering 400 (not 500) when it isn't JSON. */
export async function readJson(req: { json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    throw new ApiError(400, 'bad_request', 'The request body must be JSON')
  }
}

/**
 * An id in a URL: a plain whole number from 1, written in decimal, so `0x1`, `1e0`, `01`, ` 1` and `1.0` name
 * nothing rather than aliasing id 1.
 */
export const PathId = z
  .string()
  .regex(/^[1-9]\d{0,14}$/, 'must be a whole number from 1')
  .transform(Number)

/** The id in a URL, or a 404 `not_found` with `message` when there's no such thing. */
export function pathId(param: string | undefined, message: string): number {
  const parsed = PathId.safeParse(param)
  if (!parsed.success) throw new ApiError(404, 'not_found', message)
  return parsed.data
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/** True for a hostname that names this computer: `localhost`, `127.0.0.1`, or `[::1]` (any letter case). */
export function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTNAMES.has(hostname.toLowerCase())
}

/** The hostname part of a Host header: `[::1]:4321` → `[::1]`, `localhost:5173` → `localhost`, `127.0.0.1` → itself. */
function hostHeaderHostname(host: string): string {
  return /^(\[[^\]]*\]|[^:]*)(?::\d*)?$/.exec(host.trim())?.[1] ?? ''
}

/**
 * Whether an Origin is the page this server answers for: the same host and port as the Host header. That is Binder's
 * own page, or the dev server's page, which it proxies with its own Host. Another page on this computer (another
 * port) is another origin.
 */
function isSameOrigin(origin: string, host: string): boolean {
  try {
    return new URL(origin).host.toLowerCase() === host.trim().toLowerCase()
  } catch {
    return false
  }
}

/** `Sec-Fetch-Site` values a browser sends for Binder's own page, or for a request typed by hand. */
const OWN_FETCH_SITES = new Set(['same-origin', 'none'])

/**
 * Refuses API requests that don't come from this computer. The Host header must name this computer (defeats DNS
 * rebinding), and a request that can change something must come from Binder's own page (defeats CSRF), not from
 * another site, nor from another page on this computer (another port).
 */
export const localOnly: MiddlewareHandler = async (c, next) => {
  const host = c.req.header('host')
  let allowed = host !== undefined && isLocalHostname(hostHeaderHostname(host))
  if (host !== undefined && allowed && c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('origin')
    const site = c.req.header('sec-fetch-site')
    allowed = (site === undefined || OWN_FETCH_SITES.has(site)) && (origin === undefined || isSameOrigin(origin, host))
  }
  if (!allowed) throw new ApiError(403, 'forbidden', 'Requests must come from this computer')
  await next()
}
