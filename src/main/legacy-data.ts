import { app } from 'electron'
import { existsSync, readdirSync, renameSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { forgetUnreadableSecrets } from './settings'
import { applyOpenAtLogin } from './startup'

// The app used to be called SteveNola, and Electron names the data folder after the app. The first
// time Heard starts, the old folder (meetings, settings, speech model, browser storage) moves over.

const OLD_FOLDER = 'SteveNola'

let moved = false

function hasData(dir: string): boolean {
  return existsSync(join(dir, 'settings.json')) || existsSync(join(dir, 'meetings'))
}

/** Must run before anything uses the data folder, the single-instance lock included. */
export function moveLegacyData(): void {
  const from = join(app.getPath('appData'), OLD_FOLDER)
  const to = app.getPath('userData')
  if (!existsSync(from) || hasData(to)) return

  if (!existsSync(to)) {
    try {
      renameSync(from, to)
      moved = true
    } catch (err) {
      // Usually SteveNola is still running. Use its folder this time and try again next start.
      console.warn('Could not move the SteveNola data folder:', err instanceof Error ? err.message : err)
      app.setPath('userData', from)
    }
    return
  }

  // The new folder exists but holds no meetings or settings: move in whatever it doesn't have.
  for (const name of readdirSync(from)) {
    if (existsSync(join(to, name))) continue
    try {
      renameSync(join(from, name), join(to, name))
      moved = true
    } catch (err) {
      console.warn(`Could not move ${name} from the SteveNola data folder:`, err instanceof Error ? err.message : err)
    }
  }
  try {
    rmdirSync(from)
  } catch {
    // Something was left behind; keep it rather than delete it.
  }
}

/** After the move, once the app is ready: settle what depends on the app's name or location. */
export function finishLegacyDataMove(): void {
  if (!moved) return
  // On a Mac the keychain entry that decrypts saved API keys is named after the app.
  forgetUnreadableSecrets()
  // The login item still points at the SteveNola app.
  applyOpenAtLogin()
}
