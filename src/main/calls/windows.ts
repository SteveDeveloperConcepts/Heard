import { app } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

// Windows records microphone use per app under this key (it drives the "in use" indicator in the
// taskbar). An app is using the mic right now when its LastUsedTimeStop is 0 and its
// LastUsedTimeStart isn't. Reading it needs no permission and never touches audio. Some Windows
// builds stopped updating it, so it's only a fallback for the Core Audio monitor below.
const MIC_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone'

/** Names (last key segment) of the entries currently using the microphone, from `reg query /s` output. */
export function parseActiveMicEntries(output: string): string[] {
  const active: string[] = []
  let entry: string | null = null
  let start = 0n
  let stop = 0n

  const finish = () => {
    if (entry && start > 0n && stop === 0n) active.push(entry)
  }

  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('HKEY_')) {
      finish()
      entry = line.slice(line.lastIndexOf('\\') + 1)
      start = 0n
      stop = 0n
      continue
    }
    const value = /^\s+(LastUsedTimeStart|LastUsedTimeStop)\s+REG_QWORD\s+(0x[0-9a-f]+)/i.exec(line)
    if (!value) continue
    if (value[1] === 'LastUsedTimeStart') start = BigInt(value[2])
    else stop = BigInt(value[2])
  }
  finish()
  return active
}

export function activeMicEntries(): Promise<string[]> {
  const reg = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe')
  return new Promise((resolve) => {
    execFile(reg, ['query', MIC_KEY, '/s'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? [] : parseActiveMicEntries(stdout))
    })
  })
}

/**
 * Core Audio's view (see native/win/call-monitor.ps1): for each process capturing from a microphone,
 * its exe path followed by its parents' (SteveNola itself is left out).
 */
export interface WindowsMicReport {
  sessions: string[][]
}

function monitorScriptPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'call-monitor.ps1') : join(app.getAppPath(), 'native', 'win', 'call-monitor.ps1')
}

/**
 * Starts the script that reports which processes capture from a microphone. It prints a report
 * whenever that changes, and quits by itself if SteveNola does. Returns null when it can't start.
 */
export function startWindowsMonitor(onReport: (report: WindowsMicReport) => void, onExit: () => void): ChildProcess | null {
  const script = monitorScriptPath()
  if (!existsSync(script)) {
    console.warn(`Call detection falls back to the registry: ${script} is missing.`)
    return null
  }
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  // Run as a script block read from the file: an execution policy set by Group Policy blocks
  // unsigned script files, but not script blocks. The path goes in an environment variable, so
  // no quoting can break it.
  const command = `& ([scriptblock]::Create([IO.File]::ReadAllText($env:STEVENOLA_CALL_MONITOR))) -OwnerPid ${process.pid}`
  const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-MTA', '-Command', command], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, STEVENOLA_CALL_MONITOR: script }
  })
  createInterface({ input: child.stdout! }).on('line', (line) => {
    try {
      onReport(JSON.parse(line) as WindowsMicReport)
    } catch {
      // Ignore anything that isn't a report.
    }
  })
  createInterface({ input: child.stderr! }).on('line', (line) => console.warn('Call monitor:', line))
  child.on('error', (err) => console.error('Call monitor failed:', err))
  child.on('exit', onExit)
  return child
}

/**
 * The names an exe path can have under the registry key above, so the same app patterns match:
 * the path with "#" for "\", and for a Microsoft Store app its package family name.
 */
export function entryNamesForPath(path: string): string[] {
  const names = [path.replace(/\\/g, '#')]
  // Store apps live in WindowsApps\<name>_<version>_<arch>_<resource>_<publisher id>\.
  const store = /\\WindowsApps\\([^\\_]+)_[^\\]*_([^\\_]+)\\/i.exec(path)
  if (store) names.push(`${store[1]}_${store[2]}`)
  return names
}
