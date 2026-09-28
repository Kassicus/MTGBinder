import fs from 'node:fs'
import path from 'node:path'

/** Startup checks and messages for the server (`main.ts`): one clear line each, instead of a stack trace. */

/** What's wrong with the `PORT` setting, or null when it's unset or a port number (1–65535). */
export function portProblem(raw: string | undefined): string | null {
  if (raw === undefined) return null
  return /^[1-9]\d{0,4}$/.test(raw.trim()) && Number(raw) <= 65535
    ? null
    : `PORT must be a port number from 1 to 65535, not "${raw}".`
}

/** The line to print when the server can't start listening. */
export function listenFailure(err: NodeJS.ErrnoException, port: number): string {
  if (err.code === 'EADDRINUSE') {
    return `Port ${port} is already in use: Binder may already be running. Stop it, or start this one with PORT set to another port.`
  }
  if (err.code === 'EACCES') return `Binder isn't allowed to listen on port ${port}. Start it with PORT set to another port.`
  return `Couldn't start the server on port ${port}: ${err.message}`
}

/**
 * The line `pnpm start` prints when Binder.app keeps its own library (`appLibrary`) and this Binder uses another, so
 * the two aren't taken for one. Null when there's no Binder.app library, or it's the one in use.
 */
export function appLibraryNote(dataDir: string, appLibrary: string): string | null {
  if (path.resolve(dataDir) === path.resolve(appLibrary)) return null
  if (!fs.existsSync(path.join(appLibrary, 'binder.db'))) return null
  return `[library] Binder.app keeps its library in ${appLibrary}; this Binder uses ${dataDir}.`
}
