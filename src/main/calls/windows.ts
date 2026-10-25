import { execFile } from 'node:child_process'
import { join } from 'node:path'

// Windows records microphone use per app under this key (it drives the "in use" indicator in the
// taskbar). An app is using the mic right now when its LastUsedTimeStop is 0 and its
// LastUsedTimeStart isn't. Reading it needs no permission and never touches audio.
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
