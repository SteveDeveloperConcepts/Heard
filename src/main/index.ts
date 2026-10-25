import { app, BrowserWindow, Notification, shell, type Tray } from 'electron'
import { join } from 'node:path'
import { setupCallDetection, stopCallDetection } from './calls'
import { flushMeetings } from './meetings'
import { configureMediaAccess, enableMacSystemAudio } from './media'
import { registerIpc } from './ipc'
import { recorder } from './recorder'
import { loadSettings } from './settings'
import { whisperEngine } from './transcription/whisper-engine'
import { createTray } from './tray'

// Feature switches must be set before the app is ready.
enableMacSystemAudio(loadSettings().macAudioBackend)

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null // held so it isn't garbage-collected
let quitting = false

/** The generated app icon, used while running from source (`npm run icons` makes it). */
function devIcon(): string {
  return join(app.getAppPath(), 'build', 'icon.png')
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: 'SteveNola',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    // Installed builds take the icon from the app itself; `npm run dev` would show Electron's.
    ...(app.isPackaged ? {} : { icon: devIcon() }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow = win
  configureMediaAccess(win.webContents)

  win.once('ready-to-show', () => win.show())

  // Links open in the default browser; the app window never navigates away from its own page.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  // Closing the window mid-meeting keeps recording in the background, and says so.
  win.on('close', (event) => {
    if (quitting || !recorder.isActive()) return
    event.preventDefault()
    win.hide()
    if (Notification.isSupported()) {
      new Notification({
        title: 'SteveNola is still recording',
        body: 'Stop it from the tray icon, or reopen the window.'
      }).show()
    }
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)

  app.whenReady().then(() => {
    // Windows only shows toasts for a registered app ID: the installer registers ours, while in
    // development the Electron binary's own path is the one Windows knows.
    if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'com.developerconcepts.stevenola' : process.execPath)
    if (!app.isPackaged) app.dock?.setIcon(devIcon())
    registerIpc()
    createWindow()
    tray = createTray(showWindow)
    setupCallDetection(showWindow)
    app.on('activate', showWindow)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // Finish the recording (and its last transcript results) before exiting.
  app.on('before-quit', (event) => {
    quitting = true
    if (!recorder.isActive()) return
    event.preventDefault()
    void recorder.stop().finally(() => app.quit())
  })

  app.on('will-quit', () => {
    stopCallDetection()
    whisperEngine.shutdown()
    flushMeetings()
    tray?.destroy()
  })
}
