import { createApp, type AppDeps } from '../../src/server/app.ts'
import type { BulkImporter } from '../../src/server/bulk/import.ts'
import type { ScryfallClient } from '../../src/server/scryfall/client.ts'
import type { BulkStatus } from '../../src/shared/types.ts'
import { createTestDb } from './db.ts'

export const IDLE: BulkStatus = { state: 'idle', processed: 0, error: null, updatedAt: null, sourceUpdatedAt: null, cardCount: 61 }

export function stubBulk(overrides: Partial<BulkImporter> = {}): BulkImporter {
  return { status: () => IDLE, isStale: () => false, staleReason: () => null, start: () => Promise.resolve(), ...overrides }
}

interface ScryfallStubs {
  getJson?: (path: string) => Promise<unknown>
  postJson?: (path: string, body: unknown) => Promise<unknown>
  download?: (url: string) => Promise<Response>
}

/** A Scryfall client that fails loudly unless a test supplies the calls it expects. */
export function stubScryfall(stubs: ScryfallStubs = {}): ScryfallClient {
  const unexpected = () => Promise.reject(new Error('unexpected Scryfall call'))
  return {
    getJson: <T>(path: string) => (stubs.getJson?.(path) ?? unexpected()) as Promise<T>,
    postJson: <T>(path: string, body: unknown) => (stubs.postJson?.(path, body) ?? unexpected()) as Promise<T>,
    download: (url: string) => stubs.download?.(url) ?? unexpected(),
  }
}

/**
 * The app under test. `app.request()` sends no Host header of its own, so requests carry `Host: localhost:4321`
 * (what a browser on this computer sends) unless the test sets one.
 */
export function makeApp(deps: Partial<AppDeps> = {}) {
  const app = createApp({ db: createTestDb(), bulk: stubBulk(), scryfall: stubScryfall(), ...deps })
  return {
    request(path: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers)
      if (!headers.has('host')) headers.set('host', 'localhost:4321')
      return app.request(path, { ...init, headers })
    },
  }
}

export async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}
