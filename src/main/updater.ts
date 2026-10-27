import { EventEmitter } from 'node:events'
import { app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/types'
import { recorder } from './recorder'

// Installed copies find new versions through `publish` in electron-builder.yml; this is only for the
// release page the macOS notice opens.
const RELEASES = 'https://github.com/SteveDeveloperConcepts/Heard/releases'
const FIRST_CHECK_MS = 10_000
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

/**
 * How this copy gets new versions from GitHub releases:
 * - `install`: download in the background, install on restart (the Windows installer).
 * - `notify`: say a new version is out and link to it. macOS only installs updates signed with a
 *   Developer ID, and the Mac build has only an ad-hoc signature.
 * - null: none, when running from source.
 */
function updateMode(): 'install' | 'notify' | null {
  if (!app.isPackaged) return null
  if (process.platform === 'win32') return 'install'
  if (process.platform === 'darwin') return 'notify'
  return null
}

interface UpdaterEvents {
  /** A newer version was found, or finished downloading. */
  state: [UpdateState]
}

/** Checks GitHub for a newer Heard shortly after starting, then every few hours. */
class Updater extends EventEmitter<UpdaterEvents> {
  private current: UpdateState | null = null
  private checking = false

  /** The newer version found since Heard started, or null. */
  state(): UpdateState | null {
    return this.current
  }

  start(): void {
    const mode = updateMode()
    if (!mode) return

    autoUpdater.autoDownload = mode === 'install'
    // electron-updater sends a random ID kept for this install, for staged rollouts. Heard doesn't
    // stage releases, and sends nothing that tells one user from another.
    autoUpdater.requestHeaders = { 'x-user-staging-id': '' }
    // Offline, or GitHub can't be reached: the next check tries again.
    autoUpdater.on('error', () => {})
    autoUpdater.on('update-available', (info) => {
      if (mode === 'notify') this.announce({ kind: 'available', version: info.version })
    })
    autoUpdater.on('update-downloaded', (info) => this.announce({ kind: 'ready', version: info.version }))

    setTimeout(() => void this.check(), FIRST_CHECK_MS)
    setInterval(() => void this.check(), CHECK_EVERY_MS)
  }

  /** `ready`: quit and install it. `available`: open its release page. */
  async install(): Promise<void> {
    const update = this.current
    if (update?.kind === 'available') {
      await shell.openExternal(`${RELEASES}/tag/v${update.version}`)
      return
    }
    if (update?.kind !== 'ready') return
    if (recorder.isActive()) throw new Error('Stop recording before restarting to update.')
    // The installer closes Heard, so let a recording that was just stopped finish its transcript first.
    await recorder.whenFinished()
    // Silent, then start the new version: the installer already knows where Heard is installed.
    autoUpdater.quitAndInstall(true, true)
  }

  private announce(state: UpdateState): void {
    // Checks every few hours find the same version again; only a new one is news.
    if (this.current?.kind === state.kind && this.current.version === state.version) return
    this.current = state
    this.emit('state', state)
  }

  private async check(): Promise<void> {
    // A download can outlast the interval; don't start a second one alongside it.
    if (this.checking) return
    this.checking = true
    try {
      const result = await autoUpdater.checkForUpdates()
      await result?.downloadPromise
    } catch {
      // Reported through the error event.
    } finally {
      this.checking = false
    }
  }
}

export const updater = new Updater()
