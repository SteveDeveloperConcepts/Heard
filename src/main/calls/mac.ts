import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

// On macOS a small Swift helper (native/mac/call-monitor.swift) reports which apps are using audio
// input, because that needs Core Audio APIs Node can't reach. It prints one JSON line per change.

export type MacMicReport =
  /** macOS 14.2+: the bundle ids of processes using audio input. */
  | { mode: 'process'; inputApps: string[] }
  /** Older macOS: only whether the default mic is in use, plus which apps are running. */
  | { mode: 'device'; anyInput: boolean; running: string[] }

export function helperPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'call-monitor') : join(app.getAppPath(), 'build', 'mac', 'call-monitor')
}

/** Starts the helper; returns null when it isn't built (see scripts/build-mac-helper.mjs). */
export function startMacMonitor(onReport: (report: MacMicReport) => void): ChildProcess | null {
  const path = helperPath()
  if (!existsSync(path)) {
    console.warn(`Call detection is off: ${path} is missing. Build it with "npm run helper:mac".`)
    return null
  }
  const child = spawn(path, [], { stdio: ['ignore', 'pipe', 'inherit'] })
  createInterface({ input: child.stdout! }).on('line', (line) => {
    try {
      onReport(JSON.parse(line) as MacMicReport)
    } catch {
      // Ignore anything that isn't a report.
    }
  })
  child.on('error', (err) => console.error('Call monitor failed:', err))
  return child
}
