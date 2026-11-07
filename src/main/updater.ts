import { EventEmitter } from 'node:events'
import { app, autoUpdater as squirrel, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/types'
import { recorder } from './recorder'

// Installed copies find new versions through `publish` in electron-builder.yml; this is only for the
// release page a Mac opens when it can't install a version itself.
const RELEASES = 'https://github.com/SteveDeveloperConcepts/Heard/releases'
const FIRST_CHECK_MS = 10_000
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

interface UpdaterEvents {
  /** A newer version finished downloading, or a Mac can't install it, so it's for downloading by hand. */
  state: [UpdateState]
}

/**
 * Checks GitHub for a newer Heard shortly after starting, then every few hours. A newer version
 * downloads in the background and installs when Heard restarts or quits: on Windows with the
 * installer, on macOS from the release's zip, through Squirrel.Mac.
 */
class Updater extends EventEmitter<UpdaterEvents> {
  private current: UpdateState | null = null
  private checking = false
  /** A version Squirrel.Mac wouldn't install, so it isn't offered as ready again. */
  private refused: string | null = null

  /** The newer version found since Heard started, or null. */
  state(): UpdateState | null {
    return this.current
  }

  start(): void {
    // Running from source has no installer behind it, and Heard is only built for Windows and macOS.
    if (!app.isPackaged || (process.platform !== 'win32' && process.platform !== 'darwin')) return

    // electron-updater sends a random ID kept for this install, for staged rollouts. Heard doesn't
    // stage releases, and sends nothing that tells one user from another.
    autoUpdater.requestHeaders = { 'x-user-staging-id': '' }
    // Offline, or GitHub can't be reached: the next check tries again.
    autoUpdater.on('error', () => {})
    autoUpdater.on('update-downloaded', (info) => {
      if (info.version !== this.refused) this.announce({ kind: 'ready', version: info.version })
    })
    if (process.platform === 'darwin') {
      // macOS only installs an update signed with the same Developer ID as this copy. Squirrel.Mac
      // checks that, and that it can replace the app, after the download is announced as ready. When
      // it refuses (a build without the certificate, or a copy running from the disk image or the
      // Downloads folder), offer the release page instead of a restart that would change nothing.
      squirrel.on('error', (err) => {
        const update = this.current
        if (update?.kind !== 'ready') return
        console.warn(`Heard ${update.version} can't be installed here:`, err.message)
        this.refused = update.version
        this.announce({ kind: 'available', version: update.version })
      })
    }

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
    // Installing closes Heard, so let a recording that was just stopped finish its transcript first.
    await recorder.whenFinished()
    // Then start the new version. On Windows the installer runs silently, since it already knows
    // where Heard is installed; on macOS, Squirrel.Mac replaces the app where it is.
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
