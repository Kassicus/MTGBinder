import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { buildOcrHelper, createOcrClient, type OcrClient } from '../../src/server/scanner/ocr-client.ts'

const FAKE = [process.execPath, new URL('../helpers/fake-ocr.ts', import.meta.url).pathname]
const text = async (client: OcrClient, request: string) => (await client.recognize(request)).lines[0]?.text ?? ''
const pid = (answer: string) => answer.split(':')[0]
const alive = (id: string | undefined) => {
  try {
    process.kill(Number(id), 0)
    return true
  } catch {
    return false
  }
}

let client: OcrClient | undefined
afterEach(() => client?.close())

describe('createOcrClient', () => {
  it("sends one image at a time, so waiting doesn't count against an image's time", async () => {
    client = createOcrClient({ command: FAKE, timeoutMs: 300 })
    // The helper starts first, so its starting up doesn't count against the first image's 300 ms.
    const warm = pid(await text(client, 'warm'))
    const order: string[] = []
    const read = (name: string) => client!.recognize(`delay:200:${name}`).then((r) => (order.push(name), r))
    const answers = await Promise.all([read('first'), read('second'), read('third')])
    expect(answers.map((a) => a.lines[0]?.text.split(':')[1])).toEqual(['first', 'second', 'third'])
    expect(order).toEqual(['first', 'second', 'third'])
    expect(answers.map((a) => pid(a.lines[0]!.text))).toEqual([warm, warm, warm])
    expect(answers[0]).toMatchObject({ width: 100, height: 140 })
  })

  it("fails a request with the helper's error", async () => {
    client = createOcrClient({ command: FAKE })
    await expect(client.recognize("error:Can't read an image at /x.jpg")).rejects.toThrow("Can't read an image at /x.jpg")
  })

  it('fails the image being read when the helper crashes, and sends the next one to a new helper', async () => {
    client = createOcrClient({ command: FAKE })
    const before = pid(await text(client, 'one'))
    const crashed = client.recognize('crash')
    const next = text(client, 'two')
    await expect(crashed).rejects.toThrow(/The OCR helper stopped \(exit code 3\): boom/)
    expect(pid(await next)).not.toBe(before)
  })

  it('gives up on an image after the timeout, kills the helper, and sends the next one to a new helper (spec §5.1.4)', async () => {
    client = createOcrClient({ command: FAKE, timeoutMs: 500 })
    const before = pid(await text(client, 'one'))
    const hung = client.recognize('hang')
    const next = text(client, 'two')
    await expect(hung).rejects.toThrow('OCR took longer than 0.5 s')
    expect(pid(await next)).not.toBe(before)
    await expect.poll(() => alive(before)).toBe(false)
  })

  it("fails an image at once when the helper couldn't read the request", async () => {
    client = createOcrClient({ command: FAKE, timeoutMs: 2000 })
    await expect(client.recognize('unreadable')).rejects.toThrow('Not a request: unreadable')
    expect(await text(client, 'two')).toMatch(/:two$/)
  })

  it("ignores a line from the helper that is JSON but not an answer (null), and takes the answer after it", async () => {
    client = createOcrClient({ command: FAKE, timeoutMs: 2000 })
    expect(await text(client, 'null')).toMatch(/:null$/)
  })

  it('fails the image being read and those waiting when closed', async () => {
    client = createOcrClient({ command: FAKE })
    // Both expectations are in place before close() rejects the waiting image at once.
    const reading = expect(client.recognize('hang')).rejects.toThrow('The OCR helper stopped (SIGTERM)')
    const waiting = expect(client.recognize('two')).rejects.toThrow('The OCR helper was stopped')
    await new Promise((resolve) => setTimeout(resolve, 100))
    client.close()
    await Promise.all([reading, waiting])
  })

  it('prepares once before the first start, and again after a failed preparation', async () => {
    let calls = 0
    client = createOcrClient({
      command: FAKE,
      prepare: async () => {
        if (++calls === 1) throw new Error('no swiftc')
      },
    })
    await expect(client.recognize('one')).rejects.toThrow('no swiftc')
    await text(client, 'two')
    await text(client, 'three')
    expect(calls).toBe(2)
  })

  it("fails requests when the helper can't start", async () => {
    client = createOcrClient({ command: ['/nonexistent/binder-ocr'] })
    await expect(client.recognize('one')).rejects.toThrow(/The OCR helper stopped \(spawn .*ENOENT/)
  })
})

describe('buildOcrHelper', () => {
  const dir = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'binder-ocr-'))
    onTestFinished(() => fs.rmSync(d, { recursive: true, force: true }))
    return d
  }

  it('leaves a binary newer than its source alone', async () => {
    const d = dir()
    fs.writeFileSync(path.join(d, 'ocr.swift'), '// source')
    fs.writeFileSync(path.join(d, 'ocr'), 'binary')
    fs.utimesSync(path.join(d, 'ocr.swift'), new Date(2000, 0, 1), new Date(2000, 0, 1))
    expect(await buildOcrHelper(path.join(d, 'ocr.swift'), path.join(d, 'ocr'))).toBe(false)
  })

  it("explains when swiftc can't build it", async () => {
    const d = dir()
    fs.writeFileSync(path.join(d, 'ocr.swift'), 'this is not swift(')
    await expect(buildOcrHelper(path.join(d, 'ocr.swift'), path.join(d, 'bin', 'ocr'))).rejects.toThrow(
      "Couldn't build the OCR helper with swiftc",
    )
  }, 30_000)
})
