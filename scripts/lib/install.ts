import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** The Binder.app electron-builder made in `releaseDir`: `release/mac-arm64/`, or `release/mac/` on an Intel Mac. */
export function builtApp(releaseDir: string): string {
  const found = (fs.existsSync(releaseDir) ? fs.readdirSync(releaseDir) : [])
    .filter((dir) => dir.startsWith('mac'))
    .map((dir) => path.join(releaseDir, dir, 'Binder.app'))
    .find((bundle) => fs.existsSync(bundle))
  if (!found) throw new Error(`No Binder.app in ${releaseDir}`)
  return found
}

/** Copies Binder.app into `applicationsDir`, replacing the one there, and returns where it is. */
export function installApp(built: string, applicationsDir: string): string {
  const target = path.join(applicationsDir, 'Binder.app')
  fs.mkdirSync(applicationsDir, { recursive: true })
  fs.rmSync(target, { recursive: true, force: true })
  // ditto keeps what a Mac app needs: its signature, extended attributes, and the frameworks' symlinks.
  execFileSync('/usr/bin/ditto', [built, target])
  return target
}

/** Whether Binder.app is running from this path (replacing it then would pull files from under it). */
export function appRunning(bundle: string): boolean {
  try {
    execFileSync('/usr/bin/pgrep', ['-f', path.join(bundle, 'Contents', 'MacOS', 'Binder')], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
