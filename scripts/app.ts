// `pnpm app`: builds Binder.app (its icons, the web app, the OCR helper, then electron-builder) and puts it in
// /Applications, replacing the one there. `pnpm app --no-install` leaves it in release/, where the check runs it.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { OCR_BINARY, OCR_SOURCE, ROOT_DIR } from '../src/server/config.ts'
import { buildOcrHelper } from '../src/server/scanner/ocr-client.ts'
import { appRunning, builtApp, installApp } from './lib/install.ts'

const APPLICATIONS = '/Applications'
const installed = path.join(APPLICATIONS, 'Binder.app')
const install = !process.argv.includes('--no-install')
const quitFirst = 'Binder is running: quit it (Cmd+Q, or Quit Binder in its menu-bar icon), then run pnpm app again.'
const run = (command: string, args: string[]) => execFileSync(command, args, { cwd: ROOT_DIR, stdio: 'inherit' })

if (install && appRunning(installed)) {
  console.error(quitFirst)
  process.exit(1)
}
console.log('Drawing the icons…')
run('swift', ['scripts/make-icons.swift', 'build/icons'])
console.log('Building the web app…')
run('pnpm', ['exec', 'vite', 'build'])
if (await buildOcrHelper(OCR_SOURCE, OCR_BINARY)) console.log('Built the OCR helper.')
console.log('Packaging Binder.app…')
run('pnpm', ['exec', 'electron-builder', '--mac'])
const built = builtApp(path.join(ROOT_DIR, 'release'))
if (!install) {
  console.log(`Built ${built}`)
} else if (appRunning(installed)) {
  console.error(quitFirst)
  process.exitCode = 1
} else {
  console.log(`Installed ${installApp(built, APPLICATIONS)}. Open Binder from Spotlight, Launchpad, or Applications.`)
}
