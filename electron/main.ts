// Binder.app (spec §3.2): one window onto Binder's pages, a menu-bar icon, and Binder's server in its own process.
// Closing the window keeps Binder running (scans finish, card data refreshes); Quit (Cmd+Q, or the menu-bar icon's
// menu) stops everything. Entry point: package.json "main".
import fs from 'node:fs'
import path from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  type MenuItemConstructorOptions,
  nativeImage,
  session,
  shell,
  systemPreferences,
  Tray,
  type UtilityProcess,
  utilityProcess,
} from 'electron'
import { externalUrl, isAppUrl, permissionAllowed } from './links.ts'
import { startingPage, startupFailure } from './messages.ts'
import { type AppPaths, appPaths } from './paths.ts'
import type { ServerMessage } from './server.ts'

app.setName('Binder')

let paths: AppPaths
try {
  paths = appPaths({ appData: app.getPath('appData'), appRoot: app.getAppPath(), packaged: app.isPackaged, env: process.env })
} catch (err) {
  dialog.showErrorBox("Binder couldn't start", err instanceof Error ? err.message : String(err))
  app.exit(1)
  throw err
}
// The window's own files (storage, caches) go beside the library, not in it. Before anything reads userData.
fs.mkdirSync(paths.electronDir, { recursive: true })
app.setPath('userData', paths.electronDir)

let server: UtilityProcess | null = null
/** The web app's address, once the server listens. */
let appUrl: string | null = null
let status = 'Starting…'
let window: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
/**
 * The server's log for this run. It's never ended: the server's output can still arrive after its process exits, and
 * Binder's own exit closes the file.
 */
let log: fs.WriteStream | null = null

/** The server's log file, one per run, the one before kept beside it as binder.previous.log. */
const logFile = () => path.join(paths.logDir, 'binder.log')

function openLog(): fs.WriteStream {
  fs.mkdirSync(paths.logDir, { recursive: true })
  const file = logFile()
  if (fs.existsSync(file)) fs.renameSync(file, path.join(paths.logDir, 'binder.previous.log'))
  // Appending (to a file new after the rename), so the stream's writes land after appLog's rather than over them.
  const stream = fs.createWriteStream(file, { flags: 'a' })
  // The log is best-effort: a write that fails (a full disk, say) must never throw in the main process.
  stream.on('error', () => {})
  return stream
}

/**
 * Adds why Binder stops to the log, at once: the dialog that follows holds the main process (and the log's stream)
 * until Binder quits. Best-effort, like the log.
 */
function appLog(message: string): void {
  try {
    fs.appendFileSync(logFile(), `[app] ${message}\n`)
  } catch {
    // No log to add to: the dialog still says it.
  }
}

/**
 * Loads a page in the window. A newer load replacing one still in flight is expected (the "upgrading" page over
 * "Starting…", say), and rejects the older one's promise: that's ignored.
 */
function load(win: BrowserWindow, url: string): void {
  win.loadURL(url).catch(() => {})
}

/** Shows Binder's window, opening it (on Binder's pages, or what it's doing while it starts) if it's closed. */
function showWindow(): void {
  // A second launch or a Dock click just before Electron is ready can't open a window yet, and needn't: whenReady
  // opens it.
  if (!app.isReady()) return
  if (window) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    return
  }
  const win = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 820,
    minHeight: 560,
    title: 'Binder',
    backgroundColor: '#0c0a09',
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  window = win
  win.once('ready-to-show', () => win.show())
  // Closing the window keeps Binder running; the page (and its camera) goes with the window.
  win.on('closed', () => {
    if (window === win) window = null
  })
  // Web links open in the browser; Binder's own pages stay in the window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const external = externalUrl(url)
    if (external && !(appUrl && isAppUrl(url, appUrl))) void shell.openExternal(external)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (appUrl && isAppUrl(url, appUrl)) return
    event.preventDefault()
    const external = externalUrl(url)
    if (external) void shell.openExternal(external)
  })
  load(win, appUrl ?? startingPage(status))
}

/** Says what Binder is doing in a window still waiting for it to start. */
function setStatus(text: string): void {
  status = text
  if (window && !appUrl) load(window, startingPage(text))
}

/** Stops Binder for good after a message, when it can't start or its server stops. */
function fail(message: string): void {
  quitting = true
  appLog(message)
  dialog.showErrorBox("Binder couldn't start", message)
  server?.kill()
  app.exit(1)
}

function startServer(): void {
  log = openLog()
  const child = utilityProcess.fork(path.join(import.meta.dirname, 'server.ts'), [JSON.stringify(paths)], {
    serviceName: 'Binder server',
    stdio: 'pipe',
  })
  server = child
  child.stdout?.on('data', (chunk: Buffer) => log?.write(chunk))
  child.stderr?.on('data', (chunk: Buffer) => log?.write(chunk))
  child.on('message', (message: ServerMessage) => {
    if (message.type === 'log') log?.write(`${message.line}\n`)
    else if (message.type === 'upgrading') setStatus('Backing up your library before upgrading it (a few seconds)…')
    else if (message.type === 'failed') fail(startupFailure(message, paths.port))
    else if (message.type === 'ready') {
      appUrl = message.url
      if (window) load(window, message.url)
    }
  })
  child.on('exit', (code) => {
    if (!quitting) {
      quitting = true
      const message = `Binder's server stopped unexpectedly (exit ${code}). Open Binder again to restart it.`
      appLog(message)
      dialog.showErrorBox('Binder stopped', message)
      app.exit(1)
    }
  })
}

/**
 * Binder's own pages get the camera (the Scan page, with the Mac's permission, asked for once) and clipboard writes
 * (the Copy buttons); nothing else, and no other page.
 */
function allowPermissions(): void {
  // Chromium's fake camera (the end-to-end check's) isn't the Mac's: there's nothing to ask macOS for.
  const fakeCamera = app.commandLine.hasSwitch('use-fake-device-for-media-stream')
  session.defaultSession.setPermissionCheckHandler((_contents, permission, origin) => permissionAllowed(permission, origin, appUrl))
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
    if (!permissionAllowed(permission, details.requestingUrl ?? contents.getURL(), appUrl, mediaTypes)) return callback(false)
    const video = permission === 'media' && mediaTypes.includes('video')
    if (!video || fakeCamera) return callback(true)
    void systemPreferences.askForMediaAccess('camera').then(callback, () => callback(false))
  })
}

function buildMenus(): void {
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    // Close Window (Cmd+W): the window closes, Binder keeps running.
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as const]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  // Drawn by scripts/make-icons.swift (`pnpm icons`); the @2x file beside it is picked up on its own.
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'build', 'icons', 'trayTemplate.png'))
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Binder')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Binder', click: showWindow },
      { type: 'separator' },
      { label: 'Quit Binder', click: () => app.quit() },
    ]),
  )
}

// One Binder at a time: opening it again brings its window forward.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)
  // Clicking the Dock icon with the window closed opens it again.
  app.on('activate', showWindow)
  // Closing the window keeps Binder running (in the menu bar).
  app.on('window-all-closed', () => {})
  // Quitting stops the server first (it closes the library), for up to 5 seconds.
  app.on('before-quit', (event) => {
    if (quitting || !server) return
    event.preventDefault()
    quitting = true
    const child = server
    const force = setTimeout(() => child.kill(), 5000)
    child.once('exit', () => {
      clearTimeout(force)
      app.quit()
    })
    child.postMessage({ type: 'stop' })
  })
  // No top-level await on whenReady: an ES module entry that awaits it never gets there.
  void app.whenReady().then(() => {
    allowPermissions()
    buildMenus()
    startServer()
    showWindow()
  })
}
