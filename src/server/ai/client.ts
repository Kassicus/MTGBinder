import Anthropic from '@anthropic-ai/sdk'
import type { AiKeyStatus } from '../../shared/types.ts'
import type { KeyStore } from './key-store.ts'

/** The model for Claude's deckbuilding help (spec §2, §5.5; the owner chose Opus 5.5). Scanning never calls Anthropic. */
export const AI_MODEL = 'claude-opus-5-5'

/** The Anthropic client for the saved API key; the Settings page changes the key (spec §5.6). */
export interface AiClient {
  /** A client for the saved key, or null when there's none. */
  get(): Anthropic | null
  status(): AiKeyStatus
  /** Saves a key (or removes it with null) and makes a new client for it. */
  setKey(key: string | null): AiKeyStatus
  /** Checks that a key (by default the saved one) works, with a request that costs nothing. */
  test(key?: string): Promise<void>
}

/**
 * Binder's own client for a key. The SDK would otherwise take `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` from the
 * shell's environment, sending the key to whatever gateway the shell names: the host is pinned and the token left out.
 * It would also add the headers in the shell's `ANTHROPIC_CUSTOM_HEADERS`, even over its own key header; it reads
 * them only while a client is made, so they're hidden from it then.
 */
function anthropicFor(apiKey: string): Anthropic {
  const shellHeaders = process.env.ANTHROPIC_CUSTOM_HEADERS
  delete process.env.ANTHROPIC_CUSTOM_HEADERS
  try {
    return new Anthropic({ apiKey, baseURL: 'https://api.anthropic.com', authToken: null })
  } finally {
    if (shellHeaders !== undefined) process.env.ANTHROPIC_CUSTOM_HEADERS = shellHeaders
  }
}

export function createAiClient(store: KeyStore, make = anthropicFor): AiClient {
  let key = store.read()
  let client = key ? make(key) : null
  const status = (): AiKeyStatus => ({ configured: key !== null, hint: key ? key.slice(-4) : null })
  return {
    get: () => client,
    status,
    setKey(next) {
      store.write(next)
      key = next
      client = next ? make(next) : null
      return status()
    },
    async test(candidate) {
      const tester = candidate ? make(candidate) : client
      if (!tester) throw new Error('No API key is saved')
      await tester.models.retrieve(AI_MODEL)
    },
  }
}

/** Whether Anthropic refused a request because the conversation no longer fits Claude's context window. */
export function isPromptTooLong(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError) || err.status !== 400) return false
  const body = err.error as { error?: { message?: unknown } } | undefined
  return /prompt is too long/i.test(typeof body?.error?.message === 'string' ? body.error.message : err.message)
}

/** A short explanation of an Anthropic API failure, for the key test and Claude's answers (spec §6). */
export function describeAiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'The API key was refused'
  if (err instanceof Anthropic.PermissionDeniedError) return "The API key isn't allowed to use this model"
  if (err instanceof Anthropic.RateLimitError) return 'Anthropic is rate-limiting requests; try again shortly'
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'Anthropic took too long to answer; try again'
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Anthropic; check the internet connection"
  if (err instanceof Anthropic.APIError && err.status === 529) return 'Anthropic is overloaded right now; try again shortly'
  if (err instanceof Anthropic.InternalServerError) return `Anthropic had a problem (${err.status}); try again shortly`
  if (err instanceof Anthropic.APIError && err.status === undefined) {
    // An error event partway through a streamed answer has no HTTP status, only the error's type.
    if (err.type === 'overloaded_error') return 'Anthropic is overloaded right now; try again shortly'
    if (err.type === 'rate_limit_error') return 'Anthropic is rate-limiting requests; try again shortly'
    if (err.type === 'api_error') return 'Anthropic had a problem; try again shortly'
  }
  if (err instanceof Anthropic.APIError) {
    // The SDK's own message repeats the status and the raw JSON body; the body's message is the useful part.
    const body = err.error as { error?: { message?: unknown } } | undefined
    const detail = typeof body?.error?.message === 'string' ? body.error.message : err.message
    // An error partway through a streamed answer has no status to show.
    const status = err.status === undefined ? '' : ` (${err.status})`
    return `Anthropic answered with an error${status}: ${detail}`
  }
  return err instanceof Error ? err.message : String(err)
}
