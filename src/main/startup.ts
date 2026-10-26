import { app } from 'electron'
import { loadSettings } from './settings'

// Starting at login lets Heard catch calls all day. It starts out of sight, in the tray.

/** Windows passes this to the login item; macOS reports a login launch itself. */
const LOGIN_ARG = '--hidden'

/** Registers or removes the login item to match the setting (installed app only). */
export function applyOpenAtLogin(): void {
  if (!app.isPackaged) return
  // Windows matches the existing entry by its arguments, so removing it needs the same ones.
  app.setLoginItemSettings({ openAtLogin: loadSettings().openAtLogin, args: [LOGIN_ARG] })
}

export function startedAtLogin(): boolean {
  if (process.argv.includes(LOGIN_ARG)) return true
  return process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin === true
}
