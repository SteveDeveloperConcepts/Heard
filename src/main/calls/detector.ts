import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import type { CallInfo } from '../../shared/types'
import { appForBundleId, appForWindowsEntry, isBrowserBundleId, isBrowserWindowsEntry, type CallApp } from './apps'
import { startMacMonitor, type MacMicReport } from './mac'
import { webCallOnScreen } from './windowTitles'
import { activeMicEntries, entryNamesForPath, startWindowsMonitor } from './windows'

const POLL_MS = 3000
// The Windows monitor is started again this many times if it quits, this long after.
const MONITOR_RESTARTS = 3
const MONITOR_RESTART_MS = 10_000
// A call app can drop the mic for a moment (device switch, mute in some apps); only call it ended
// after it has been off the mic this long.
const END_GRACE_MS = 6000

interface DetectorEvents {
  started: [CallInfo]
  ended: [CallInfo]
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}

function exeName(path: string): string {
  return path.slice(path.lastIndexOf('\\') + 1).toLowerCase()
}

/**
 * Watches which call apps are using the microphone, and, while a browser is, which web call its
 * windows show. It only reads OS metadata about mic use and window titles; it never opens a
 * device or hears audio.
 */
class CallDetector extends EventEmitter<DetectorEvents> {
  private calls = new Map<string, CallInfo>() // by app id
  private lastSeen = new Map<string, number>()
  private timer: NodeJS.Timeout | null = null
  private helper: ChildProcess | null = null
  /** False on macOS before 14.2, where any mic use (ours included) looks the same. */
  private perApp = true
  /** Call apps on the mic, as of the last OS report. */
  private appsOnMic: CallApp[] = []
  private browserOnMic = false
  private browserLastOnMic = 0
  /** Windows: entries of the registry's mic usage record that are in use. */
  private registryEntries: string[] = []
  /** Windows: for each process capturing from a mic, its exe path and its parents'. */
  private sessionChains: string[][] = []
  /** The web call seen in a window title since a browser took the mic. */
  private webCall: CallApp | null = null
  private checking = false

  get running(): boolean {
    return this.timer !== null || this.helper !== null
  }

  /** Whether "ended" events can be trusted while Heard itself is using the mic. */
  get knowsWhichApp(): boolean {
    return this.perApp
  }

  start(): void {
    if (this.running) return
    this.webCall = null // a title read still in flight from before stop() may have set it
    if (process.platform === 'win32') {
      // Core Audio's capture sessions say which programs are on the mic. Windows' usage record in
      // the registry is read too, as a fallback, though some Windows builds stopped updating it.
      this.startWindowsMonitor(MONITOR_RESTARTS)
      const poll = async () => {
        this.registryEntries = await activeMicEntries()
        this.onWindowsReport()
      }
      void poll()
      this.timer = setInterval(() => void poll(), POLL_MS)
    } else if (process.platform === 'darwin') {
      this.helper = startMacMonitor((report) => this.onMacReport(report))
      // The helper reports only changes; this re-reads browser titles and checks for calls that ended.
      if (this.helper) this.timer = setInterval(() => void this.check(), POLL_MS)
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.helper?.kill()
    this.helper = null
    this.calls.clear()
    this.lastSeen.clear()
    this.appsOnMic = []
    this.browserOnMic = false
    this.webCall = null
    this.registryEntries = []
    this.sessionChains = []
  }

  /** Runs the Core Audio monitor, starting it again if it quits while detection is on. */
  private startWindowsMonitor(restartsLeft: number): void {
    const helper = startWindowsMonitor(
      (report) => {
        if (this.helper !== helper) return
        this.sessionChains = report.sessions
        this.onWindowsReport()
      },
      () => {
        if (this.helper !== helper) return // stopped on purpose
        this.helper = null
        this.sessionChains = []
        this.onWindowsReport()
        if (restartsLeft > 0) {
          setTimeout(() => {
            if (this.timer && !this.helper) this.startWindowsMonitor(restartsLeft - 1)
          }, MONITOR_RESTART_MS)
        }
      }
    )
    this.helper = helper
  }

  /** Works out the call apps and browsers on the mic from both Windows sources. */
  private onWindowsReport(): void {
    const apps = new Map<string, CallApp>()
    let browser = false
    for (const entry of this.registryEntries) {
      const app = appForWindowsEntry(entry)
      if (app) apps.set(app.id, app)
      else if (isBrowserWindowsEntry(entry)) browser = true
    }
    for (const chain of this.sessionChains) {
      for (const [i, path] of chain.entries()) {
        const names = entryNamesForPath(path)
        const app = names.map(appForWindowsEntry).find(isDefined)
        if (app) {
          apps.set(app.id, app)
          break
        }
        if (names.some(isBrowserWindowsEntry)) {
          browser = true
          break
        }
        // Only a helper speaks for its parent: WebView2 (WhatsApp and the new Teams capture in one)
        // or another process of the same exe, as Electron and Chromium apps run. Anything else, like
        // Word opened from a Teams chat, is judged on its own.
        const parent = chain[i + 1]
        if (!parent || !(exeName(path) === 'msedgewebview2.exe' || exeName(path) === exeName(parent))) break
      }
    }
    this.appsOnMic = [...apps.values()]
    this.browserOnMic = browser
    void this.check()
  }

  list(): CallInfo[] {
    return [...this.calls.values()]
  }

  link(callId: string, meetingId: string): void {
    for (const call of this.calls.values()) {
      if (call.id === callId) call.meetingId = meetingId
    }
  }

  private onMacReport(report: MacMicReport): void {
    if (report.mode === 'process') {
      this.perApp = true
      this.appsOnMic = report.inputApps.map(appForBundleId).filter(isDefined)
      this.browserOnMic = report.inputApps.some(isBrowserBundleId)
    } else {
      // Without per-process data, assume a running call app is the one holding the mic. A browser
      // can't be told apart from any other mic user, so web calls go undetected here.
      this.perApp = false
      this.appsOnMic = report.anyInput ? report.running.map(appForBundleId).filter(isDefined) : []
      this.browserOnMic = false
    }
    void this.check()
  }

  /** Works out which calls are on, adding a web call from window titles while a browser is on the mic. */
  private async check(): Promise<void> {
    if (this.checking) return
    this.checking = true
    try {
      const now = Date.now()
      if (this.browserOnMic) {
        this.browserLastOnMic = now
        // Read titles only until a call turns up: it then lasts while the browser keeps the mic,
        // even once its tab is out of sight.
        this.webCall ??= (await webCallOnScreen()) ?? null
      } else if (now - this.browserLastOnMic > END_GRACE_MS) {
        // Forget the call only once the browser has stayed off the mic, like desktop apps' calls.
        this.webCall = null
      }
      const webCalls = this.browserOnMic && this.webCall ? [this.webCall] : []
      if (this.running) this.update([...this.appsOnMic, ...webCalls])
    } catch (err) {
      console.error('Call check failed:', err)
    } finally {
      this.checking = false
    }
  }

  /** `apps`: the calls on right now. */
  private update(apps: CallApp[]): void {
    const now = Date.now()
    for (const app of apps) {
      this.lastSeen.set(app.id, now)
      if (!this.calls.has(app.id)) {
        const call: CallInfo = { id: randomUUID(), appId: app.id, appName: app.name, startedAt: now, meetingId: null }
        this.calls.set(app.id, call)
        this.emit('started', call)
      }
    }
    for (const [appId, call] of this.calls) {
      if (now - (this.lastSeen.get(appId) ?? 0) > END_GRACE_MS) {
        this.calls.delete(appId)
        this.lastSeen.delete(appId)
        this.emit('ended', call)
      }
    }
  }
}

export const callDetector = new CallDetector()
