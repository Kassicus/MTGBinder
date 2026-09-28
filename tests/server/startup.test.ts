import { describe, expect, it } from 'vitest'
import { listenFailure, portProblem } from '../../src/server/startup.ts'

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
})
