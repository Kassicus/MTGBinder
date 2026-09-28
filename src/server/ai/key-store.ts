import fs from 'node:fs'
import path from 'node:path'

/** A key line: its prefix (leading space and any `export `), then the value. */
const KEY_LINE = /^(\s*(?:export\s+)?)ANTHROPIC_API_KEY\s*=\s*(.*?)\s*$/

/**
 * A key line's value: a quoted value without its quotes (and whatever follows them, such as a comment), an unquoted
 * one without a trailing ` # comment`. A value that is only a comment (`# paste here`) is no key.
 */
function keyValue(raw: string): string {
  const quoted = /^(['"])(.*?)\1/.exec(raw)
  if (quoted) return quoted[2]!
  return raw.startsWith('#') ? '' : raw.replace(/\s+#.*$/, '')
}

/**
 * The Anthropic API key, kept in a `.env` file: the project's for Binder run from the terminal, the library folder's
 * for Binder.app (spec §3.1, §3.4, §5.6). Other lines in the file are left as they are. The file is written with mode
 * 600, so only the owner can read it.
 */
export interface KeyStore {
  /** The saved key, or null. */
  read(): string | null
  /** Saves a key, or removes it with null. */
  write(key: string | null): void
}

/** The file a save writes: `.env` itself, or the file a symlinked `.env` points to. */
function realFile(envPath: string): string {
  try {
    return fs.realpathSync(envPath)
  } catch {
    return envPath // not there yet (or a link to nothing): write it where it's named
  }
}

/** Whether `pid` is another process that is still running: a signal 0 reaches it, or it exists but isn't ours. */
function otherProcessRunning(pid: number): boolean {
  if (pid <= 0 || pid === process.pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Removes the temporary copies saves leave when a crash or kill stops them between writing and renaming
 * (`<.env>.<pid>.tmp`): they hold the key. One whose process is still running is that process's save in progress,
 * and is left to it. Best effort.
 */
function removeLeftovers(file: string): void {
  const name = path.basename(file)
  try {
    for (const entry of fs.readdirSync(path.dirname(file))) {
      const pid = entry.startsWith(`${name}.`) ? /^\.(\d+)\.tmp$/.exec(entry.slice(name.length))?.[1] : undefined
      if (pid !== undefined && !otherProcessRunning(Number(pid))) {
        fs.rmSync(path.join(path.dirname(file), entry), { force: true })
      }
    }
  } catch {
    // The folder can't be read: nothing to clean.
  }
}

export function createKeyStore(envPath: string): KeyStore {
  removeLeftovers(realFile(envPath))
  const lines = () => (fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').split('\n') : [])
  return {
    read() {
      for (const line of lines()) {
        const raw = KEY_LINE.exec(line)?.[2]
        const value = raw && keyValue(raw)
        if (value) return value
      }
      return null
    },
    write(key) {
      // The key goes where the first key line was (keeping its `export `), and any other key lines go.
      const current = lines()
      const at = current.findIndex((line) => KEY_LINE.test(line))
      const prefix = at >= 0 ? KEY_LINE.exec(current[at]!)![1]! : ''
      const kept = current.flatMap((line, i) =>
        i === at ? (key === null ? [] : [`${prefix}ANTHROPIC_API_KEY=${key}`]) : KEY_LINE.test(line) ? [] : [line],
      )
      while (kept.length > 0 && kept.at(-1) === '') kept.pop()
      if (key !== null && at < 0) kept.push(`ANTHROPIC_API_KEY=${key}`)
      const text = kept.length > 0 ? `${kept.join('\n')}\n` : ''
      const file = realFile(envPath)
      removeLeftovers(file)
      if (fs.existsSync(file) && fs.statSync(file).nlink > 1) {
        // A hard-linked file is written in place, so every name for it sees the key; renaming over it would split it.
        // Writing in place isn't atomic (a crash part-way can cut the file short), but a hard link needs it. The file
        // is made private before the key goes in, so others can't read it even for a moment.
        fs.chmodSync(file, 0o600)
        fs.writeFileSync(file, text)
        return
      }
      // A private file renamed over .env (or the file a symlinked .env points to): the key is never in a file others
      // can read, and a crash can't cut off the owner's other lines.
      const temp = `${file}.${process.pid}.tmp`
      try {
        fs.writeFileSync(temp, text, { flag: 'wx', mode: 0o600 })
        fs.chmodSync(temp, 0o600) // exactly 600, whatever the umask took away
        fs.renameSync(temp, file)
      } catch (err) {
        fs.rmSync(temp, { force: true }) // it holds the key
        throw err
      }
    },
  }
}
