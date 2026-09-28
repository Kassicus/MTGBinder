import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'

/** One line of text Vision read, with its box normalized to the image (origin at the top left). */
export interface OcrLine {
  text: string
  confidence: number
  box: { x: number; y: number; w: number; h: number }
}

export interface OcrResult {
  width: number
  height: number
  lines: OcrLine[]
}

export interface OcrClient {
  /** Reads the text in an image file. Rejects if the helper fails, crashes, or takes longer than the timeout. */
  recognize(imagePath: string): Promise<OcrResult>
  /** Stops the helper. A later recognize() starts it again. */
  close(): void
}

export interface OcrClientOptions {
  /** The helper's command and arguments. */
  command: readonly string[]
  /** How long one image may take (spec §5.1.4: 10 s). */
  timeoutMs?: number
  /** Runs before the helper first starts, for example to build it; a rejection fails that request. */
  prepare?: () => Promise<void>
}

interface Job {
  imagePath: string
  resolve: (result: OcrResult) => void
  reject: (err: Error) => void
}

/** The image the helper is reading: its request id, its timer, and the helper process it went to. */
interface Reading extends Job {
  id: string
  timer: NodeJS.Timeout
  proc: ChildProcessWithoutNullStreams
}

/**
 * Talks to the OCR helper (spec §5.1.4): one long-running process that reads one image at a time, answering one JSON
 * line per request. Images are sent to it one at a time, so each one's timeout counts from when the helper starts on
 * it, not while it waits behind another. A crash or a timeout fails the image being read and stops the process; the
 * images waiting behind it go to a new one.
 */
export function createOcrClient({ command, timeoutMs = 10_000, prepare }: OcrClientOptions): OcrClient {
  let child: ChildProcessWithoutNullStreams | null = null
  let prepared: Promise<void> | null = null
  let nextId = 1
  const waiting: Job[] = []
  let reading: Reading | null = null

  /** Ends the image being read (with its answer, or an error), then sends the next. */
  function finish(outcome: { result: OcrResult } | { error: Error }) {
    const job = reading
    if (!job) return
    clearTimeout(job.timer)
    reading = null
    if ('error' in outcome) job.reject(outcome.error)
    else job.resolve(outcome.result)
    sendNext()
  }

  function sendNext() {
    if (reading || waiting.length === 0) return
    const job = waiting.shift()!
    child ??= start()
    const proc = child
    const id = String(nextId++)
    const timer = setTimeout(() => {
      if (reading?.id !== id) return
      if (child === proc) child = null // the images waiting go to a new helper
      finish({ error: new Error(`OCR took longer than ${timeoutMs / 1000} s`) })
      proc.kill('SIGKILL')
    }, timeoutMs)
    reading = { ...job, id, timer, proc }
    proc.stdin.write(`${JSON.stringify({ id, path: job.imagePath })}\n`)
  }

  function start(): ChildProcessWithoutNullStreams {
    const [bin, ...args] = command
    const proc = spawn(bin!, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = '' // this process's last words, for the error when it stops
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000)
    })
    createInterface({ input: proc.stdout }).on('line', (line) => {
      if (reading?.proc !== proc) return
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        return
      }
      // JSON that isn't an object (null, a number) isn't an answer either.
      if (typeof parsed !== 'object' || parsed === null) return
      const message = parsed as { id?: string; error?: string } & Partial<OcrResult>
      // An answer with no id is the helper saying it couldn't read the request, which is the one it's on.
      if (message.id !== reading.id && message.id !== '') return
      if (message.error !== undefined) finish({ error: new Error(message.error) })
      else finish({ result: { width: message.width ?? 0, height: message.height ?? 0, lines: message.lines ?? [] } })
    })
    const stopped = (reason: string) => {
      if (child === proc) child = null
      if (reading?.proc === proc) {
        finish({ error: new Error(`The OCR helper stopped (${reason})${stderr.trim() ? `: ${stderr.trim()}` : ''}`) })
      }
    }
    proc.on('error', (err) => stopped(err.message))
    proc.on('exit', (code, signal) => stopped(signal ?? `exit code ${code}`))
    proc.stdin.on('error', () => {}) // a write to a helper that just died; 'exit' reports it
    return proc
  }

  return {
    async recognize(imagePath) {
      if (prepare) {
        prepared ??= prepare().catch((err: unknown) => {
          prepared = null
          throw err
        })
        await prepared
      }
      return new Promise<OcrResult>((resolve, reject) => {
        waiting.push({ imagePath, resolve, reject })
        sendNext()
      })
    },
    close() {
      const stopped = new Error('The OCR helper was stopped')
      for (const job of waiting.splice(0)) job.reject(stopped)
      child?.kill() // its exit fails the image it was reading
      child = null
    },
  }
}

const execFileAsync = promisify(execFile)

/**
 * Compiles the Swift helper with `swiftc` when the binary is missing or older than its source. Returns true when it
 * compiled.
 */
export async function buildOcrHelper(source: string, binary: string): Promise<boolean> {
  const built = fs.statSync(binary, { throwIfNoEntry: false })
  if (built && built.mtimeMs >= fs.statSync(source).mtimeMs) return false
  fs.mkdirSync(path.dirname(binary), { recursive: true })
  try {
    await execFileAsync('swiftc', ['-O', source, '-o', binary])
  } catch (err) {
    const detail = (err as { stderr?: string }).stderr?.trim() || (err as Error).message
    throw new Error(
      `Couldn't build the OCR helper with swiftc (install Xcode's command line tools: xcode-select --install): ${detail}`,
    )
  }
  return true
}
