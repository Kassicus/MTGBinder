import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { appLibraryNote, listenFailure, portProblem } from '../../src/server/startup.ts'

const failure = (code: string, message = 'boom') => Object.assign(new Error(message), { code })

describe('startup messages', () => {
  it('accepts no PORT, or a port number, and explains anything else', () => {
    for (const ok of [undefined, '4321', '1', '65535', ' 8080 ']) expect(portProblem(ok)).toBeNull()
    for (const bad of ['abc', '0', '65536', '43.21', '-1', '', '0x10E1', '4321a']) {
      expect(portProblem(bad)).toBe(`PORT must be a port number from 1 to 65535, not "${bad}".`)
    }
  })

  it('says in one line why the server could not listen', () => {
    expect(listenFailure(failure('EADDRINUSE'), 4321)).toBe(
      'Port 4321 is already in use: Binder may already be running. Stop it, or start this one with PORT set to another port.',
    )
    expect(listenFailure(failure('EACCES'), 80)).toBe("Binder isn't allowed to listen on port 80. Start it with PORT set to another port.")
    expect(listenFailure(failure('EOTHER', 'the network is down'), 4321)).toBe("Couldn't start the server on port 4321: the network is down")
  })

  it('says which library this Binder uses when Binder.app keeps its own', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binder-startup-'))
    onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }))
    const appLibrary = path.join(dir, 'Application Support', 'Binder')
    const data = path.join(dir, 'data')
    expect(appLibraryNote(data, appLibrary)).toBeNull()
    fs.mkdirSync(appLibrary, { recursive: true })
    fs.writeFileSync(path.join(appLibrary, 'binder.db'), '')
    expect(appLibraryNote(data, appLibrary)).toBe(`[library] Binder.app keeps its library in ${appLibrary}; this Binder uses ${data}.`)
    expect(appLibraryNote(appLibrary, appLibrary)).toBeNull()
  })
})
