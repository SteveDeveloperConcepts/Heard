import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import type { CallInfo } from '../../shared/types'
import { appForBundleId, appForWindowsEntry, type CallApp } from './apps'
import { startMacMonitor, type MacMicReport } from './mac'
import { activeMicEntries } from './windows'

const POLL_MS = 3000
// A call app can drop the mic for a moment (device switch, mute in some apps); only call it ended
// after it has been off the mic this long.
const END_GRACE_MS = 6000

interface DetectorEvents {
  started: [CallInfo]
  ended: [CallInfo]
}

/**
 * Watches which call apps are using the microphone. It only reads OS metadata about mic use;
 * it never opens a device or hears audio.
 */
class CallDetector extends EventEmitter<DetectorEvents> {
  private calls = new Map<string, CallInfo>() // by app id
  private lastSeen = new Map<string, number>()
  private timer: NodeJS.Timeout | null = null
  private helper: ChildProcess | null = null
  /** False on macOS before 14.2, where any mic use (ours included) looks the same. */
  private perApp = true

  get running(): boolean {
    return this.timer !== null || this.helper !== null
  }

  /** Whether "ended" events can be trusted while SteveNola itself is using the mic. */
  get knowsWhichApp(): boolean {
    return this.perApp
  }

  start(): void {
    if (this.running) return
    if (process.platform === 'win32') {
      const poll = () => void activeMicEntries().then((entries) => this.update(entries.map(appForWindowsEntry)))
      poll()
      this.timer = setInterval(poll, POLL_MS)
    } else if (process.platform === 'darwin') {
      this.helper = startMacMonitor((report) => this.onMacReport(report))
      // The helper reports only changes; this re-checks the grace period for calls that ended.
      if (this.helper) this.timer = setInterval(() => this.update(null), POLL_MS)
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.helper?.kill()
    this.helper = null
    this.calls.clear()
    this.lastSeen.clear()
  }

  list(): CallInfo[] {
    return [...this.calls.values()]
  }

  link(callId: string, meetingId: string): void {
    for (const call of this.calls.values()) {
      if (call.id === callId) call.meetingId = meetingId
    }
  }

  private macActive: CallApp[] = []

  private onMacReport(report: MacMicReport): void {
    if (report.mode === 'process') {
      this.perApp = true
      this.macActive = report.inputApps.map(appForBundleId).filter((a) => a !== undefined)
    } else {
      // Without per-process data, assume a running call app is the one holding the mic.
      this.perApp = false
      this.macActive = report.anyInput ? report.running.map(appForBundleId).filter((a) => a !== undefined) : []
    }
    this.update(this.macActive)
  }

  /** `apps`: the call apps on the mic right now, or null to only re-check pending endings. */
  private update(apps: (CallApp | undefined)[] | null): void {
    const now = Date.now()
    const current = apps ?? (process.platform === 'darwin' ? this.macActive : null)
    if (current) {
      for (const app of current) {
        if (!app) continue
        this.lastSeen.set(app.id, now)
        if (!this.calls.has(app.id)) {
          const call: CallInfo = { id: randomUUID(), appId: app.id, appName: app.name, startedAt: now, meetingId: null }
          this.calls.set(app.id, call)
          this.emit('started', call)
        }
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
