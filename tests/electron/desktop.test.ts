import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { externalUrl, isAppUrl } from '../../electron/links.ts'
import { startingPage, startupFailure } from '../../electron/messages.ts'
import { appPaths } from '../../electron/paths.ts'

describe('appPaths (spec §3.2)', () => {
  const appData = '/Users/me/Library/Application Support'
  const base = { appData, appRoot: '/Applications/Binder.app/Contents/Resources/app', packaged: true, env: {} }

  it('keeps the library in Application Support, with the key file in it and the window\'s own files apart', () => {
    expect(appPaths(base)).toEqual({
      dataDir: `${appData}/Binder`,
      envPath: `${appData}/Binder/.env`,
      electronDir: `${appData}/Binder/Electron`,
      logDir: `${appData}/Binder/Logs`,
      webDistDir: '/Applications/Binder.app/Contents/Resources/app/dist/web',
      ocrBinary: '/Applications/Binder.app/Contents/Resources/app/bin/ocr',
      port: 4321,
    })
  })

  it('uses the project\'s data/ when run from the project, building the OCR helper from its source there', () => {
    const paths = appPaths({ ...base, appRoot: '/dev/binder', packaged: false })
    expect(paths).toMatchObject({ dataDir: '/dev/binder/data', envPath: '/dev/binder/data/.env', ocrSource: '/dev/binder/native/ocr.swift' })
  })

  it('takes BINDER_DATA_DIR and PORT for checks, and says when PORT is not a port number', () => {
    expect(appPaths({ ...base, env: { BINDER_DATA_DIR: 'relative/lib', PORT: '4455' } })).toMatchObject({
      dataDir: path.resolve('relative/lib'),
      envPath: path.join(path.resolve('relative/lib'), '.env'),
      port: 4455,
    })
    expect(() => appPaths({ ...base, env: { PORT: 'abc' } })).toThrow('PORT must be a port number from 1 to 65535, not "abc".')
  })
})

describe('links', () => {
  it('keeps Binder\'s own pages in the window', () => {
    expect(isAppUrl('http://localhost:4321/decks/3', 'http://localhost:4321')).toBe(true)
    expect(isAppUrl('http://localhost:4455/', 'http://localhost:4321')).toBe(false)
    expect(isAppUrl('https://scryfall.com/card/m10/146', 'http://localhost:4321')).toBe(false)
    expect(isAppUrl('not a url', 'http://localhost:4321')).toBe(false)
  })

  it('opens web links in the browser, and nothing else', () => {
    expect(externalUrl('https://scryfall.com/card/m10/146')).toBe('https://scryfall.com/card/m10/146')
    expect(externalUrl('http://example.com/')).toBe('http://example.com/')
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'mailto:me@example.com', 'nonsense']) expect(externalUrl(url)).toBeNull()
  })
})

describe('messages', () => {
  it('says what to do when the port is taken, and anything else as the server said it', () => {
    expect(startupFailure({ code: 'port_in_use', message: 'Port 4321 is already in use: …' }, 4321)).toBe(
      'Port 4321 is already in use: Binder may already be running from the terminal (pnpm start). Quit that one, then open Binder again.',
    )
    expect(startupFailure({ code: 'library', message: '[database] file is not a database' }, 4321)).toBe(
      '[database] file is not a database',
    )
  })

  it('shows what Binder is doing while it starts, escaped', () => {
    const page = startingPage('Backing up your library <before> upgrading it…')
    expect(page.startsWith('data:text/html;charset=utf-8,')).toBe(true)
    expect(decodeURIComponent(page)).toContain('Backing up your library &lt;before&gt; upgrading it…')
  })
})
