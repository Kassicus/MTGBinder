// `pnpm move-library`: copies the library from data/ (or BINDER_DATA_DIR) to Binder.app's folder,
// ~/Library/Application Support/Binder, once (spec §3.2). Binder must not be running; data/ is left as it is, and the
// API key isn't copied (it's entered again in Binder.app's Settings).
import net from 'node:net'
import { APP_LIBRARY_DIR, DATA_DIR } from '../src/server/config.ts'
import { APP_PORT } from '../electron/paths.ts'
import { appRunning } from './lib/install.ts'
import { describeLibrary, moveLibrary, MoveError } from './lib/move.ts'

/** Whether something answers on the port: Binder from the terminal, or Binder.app. */
function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1')
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

if (appRunning('/Applications/Binder.app') || (await answers(APP_PORT))) {
  console.error('Binder is running: quit it (Cmd+Q in Binder.app, or Ctrl+C where pnpm start runs), then run pnpm move-library again.')
  process.exit(1)
}
try {
  const summary = await moveLibrary(DATA_DIR, APP_LIBRARY_DIR)
  console.log(`Copied your library (${describeLibrary(summary)}) to ${APP_LIBRARY_DIR}.`)
  console.log('Open Binder.app to use it, and enter your Anthropic API key again in Settings → Anthropic API key.')
  console.log(`Your original is still in ${DATA_DIR}; delete it once you've checked Binder.app.`)
} catch (err) {
  if (!(err instanceof MoveError)) throw err
  console.error(err.message)
  process.exit(1)
}
