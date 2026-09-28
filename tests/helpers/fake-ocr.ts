// A stand-in for bin/ocr in tests. Like bin/ocr, it reads one request at a time, in order, and answers each with one
// JSON line, with the behavior its "path" asks for: "crash" exits, "hang" never answers (so nothing after it is read),
// "error:<message>" fails, "delay:<ms>:<text>" answers late, "unreadable" answers the way bin/ocr answers a line that
// isn't a request (with no id), "null" writes a line of JSON that isn't an answer (null) before its answer; anything
// else answers one line of text "<pid>:<path>".
import { createInterface } from 'node:readline'

function handle(input: string): Promise<void> {
  const { id, path } = JSON.parse(input) as { id: string; path: string }
  const send = (message: object) => {
    process.stdout.write(`${JSON.stringify(message)}\n`)
  }
  const answer = (text: string) =>
    send({ id, width: 100, height: 140, lines: [{ text, confidence: 1, box: { x: 0, y: 0, w: 1, h: 0.1 } }] })
  if (path === 'crash') {
    process.stderr.write('boom\n')
    process.exit(3)
  } else if (path === 'hang') {
    return new Promise(() => {})
  } else if (path === 'unreadable') {
    send({ id: '', error: 'Not a request: unreadable' })
  } else if (path === 'null') {
    process.stdout.write('null\n')
    answer(`${process.pid}:${path}`)
  } else if (path.startsWith('error:')) {
    send({ id, error: path.slice('error:'.length) })
  } else if (path.startsWith('delay:')) {
    const [, ms, text] = path.split(':')
    return new Promise((resolve) => setTimeout(() => resolve(answer(`${process.pid}:${text}`)), Number(ms)))
  } else {
    answer(`${process.pid}:${path}`)
  }
  return Promise.resolve()
}

let reading = Promise.resolve()
createInterface({ input: process.stdin }).on('line', (input) => {
  reading = reading.then(() => handle(input))
})
