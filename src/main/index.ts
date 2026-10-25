import { app, BrowserWindow, Notification, shell, type Tray } from 'electron'
import { join } from 'node:path'
import { setupCallDetection, stopCallDetection } from './calls'
import { flushMeetings } from './meetings'
import { configureMediaAccess, enableMacSystemAudio } from './media'
import { registerIpc } from './ipc'
import { recorder } from './recorder'
import { loadSettings } from './settings'
import { startedAtLogin } from './startup'
import { whisperEngine } from './transcription/whisper-engine'
import { createTray } from './tray'

// Feature switches must be set before the app is ready.
enableMacSystemAudio(loadSettings().macAudioBackend)

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null // held so it isn't garbage-collected
let quitting = false
let toldAboutTray = false

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

function notify(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body }).show()
}

/** `visible: false` creates the window hidden, e.g. when starting at login. */
function createWindow({ visible = true } = {}): void {
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

  if (visible) win.once('ready-to-show', () => win.show())

  // Links open in the default browser; the app window never navigates away from its own page.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  // Closing the window hides it instead: always mid-meeting, so recording continues, and otherwise
  // when the user wants SteveNola kept in the tray to catch calls. Either way it says so.
  win.on('close', (event) => {
    if (quitting) return
    const recording = recorder.isActive()
    if (!recording && !loadSettings().keepInTray) return
    event.preventDefault()
    // Hiding a full-screen Mac window would leave an empty full-screen Space behind.
    if (win.isFullScreen()) {
      win.once('leave-full-screen', () => win.hide())
      win.setFullScreen(false)
    } else {
      win.hide()
    }
    if (recording) {
      notify('SteveNola is still recording', 'Stop it from the tray icon, or reopen the window.')
    } else if (!toldAboutTray) {
      toldAboutTray = true
      notify('SteveNola is still running', 'It keeps watching for calls from the tray. Quit from the tray icon.')
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
    // Started at login: wait in the tray (the hidden window still hears about calls).
    createWindow({ visible: !startedAtLogin() })
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
