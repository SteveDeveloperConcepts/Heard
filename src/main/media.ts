import { app, desktopCapturer, session, shell, systemPreferences, webContents, type WebContents } from 'electron'
import type { MacAudioBackend, MediaAccess, PermissionStatus } from '../shared/types'

// The "only listens when asked" guarantee lives here. The renderer can only open the microphone or
// system audio while a recording is armed by the main process; every other request is refused,
// whatever the page asks for.

let armed = false
let appContents: WebContents | null = null

export function setCaptureArmed(value: boolean): void {
  armed = value
}

export function isCaptureArmed(): boolean {
  return armed
}

/**
 * Chromium only exposes system-audio loopback on macOS behind these feature switches
 * (ScreenCaptureKit by default, or a Core Audio tap on macOS 14.2+). Must run before `ready`.
 */
export function enableMacSystemAudio(backend: MacAudioBackend): void {
  if (process.platform !== 'darwin') return
  const key = 'enable-features'
  const features = app.commandLine.hasSwitch(key) ? app.commandLine.getSwitchValue(key).split(',').filter(Boolean) : []
  if (app.commandLine.hasSwitch(key)) app.commandLine.removeSwitch(key)
  features.push('MacLoopbackAudioForScreenShare')
  features.push(backend === 'coreaudio-tap' ? 'MacCatapSystemAudioLoopbackCapture' : 'MacSckSystemAudioLoopbackOverride')
  app.commandLine.appendSwitch(key, features.join(','))
}

function isAppContents(contents: WebContents | null | undefined): boolean {
  return Boolean(contents && appContents && contents.id === appContents.id)
}

/** Installs the session handlers that gate microphone and system-audio capture. */
export function configureMediaAccess(contents: WebContents): void {
  appContents = contents
  const ses = session.defaultSession

  // Checks are passive (e.g. device labels in enumerateDevices) and never open a device.
  ses.setPermissionCheckHandler((wc, permission) => {
    if (!isAppContents(wc)) return false
    return permission === 'media' || permission === 'clipboard-sanitized-write'
  })

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (!isAppContents(wc)) return callback(false)
    if (permission === 'media') return callback(armed)
    // Since Electron 45, getDisplayMedia asks for 'display-capture' before the display media
    // handler below runs; refusing it fails the call outright. Only system audio is ever wanted.
    if (permission === 'display-capture') {
      const withAudio = 'mediaTypes' in details && details.mediaTypes?.includes('audio') === true
      return callback(armed && withAudio)
    }
    if (permission === 'clipboard-sanitized-write') return callback(true)
    callback(false)
  })

  // getDisplayMedia is how Chromium hands out system-audio loopback. We grant it without a picker,
  // but only while armed, and only to our own window. The renderer discards the video track.
  ses.setDisplayMediaRequestHandler((request, callback) => {
    const requester = request.frame ? webContents.fromFrame(request.frame) : undefined
    if (!armed || !isAppContents(requester) || !request.audioRequested) {
      console.warn('System audio request refused:', { armed, ownWindow: isAppContents(requester), audio: request.audioRequested })
      return callback(null)
    }
    desktopCapturer
      .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => {
        if (!armed || sources.length === 0) {
          console.warn('System audio request refused:', { armed, screens: sources.length })
          return callback(null)
        }
        callback({ video: sources[0], audio: 'loopback' })
      })
      .catch((err) => {
        console.error('System audio capture failed:', err)
        callback(null)
      })
  })
}

function access(kind: 'microphone' | 'screen'): MediaAccess {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return 'granted'
  if (kind === 'screen' && process.platform !== 'darwin') return 'granted'
  return systemPreferences.getMediaAccessStatus(kind)
}

export function permissionStatus(): PermissionStatus {
  return { platform: process.platform, microphone: access('microphone'), screen: access('screen') }
}

export async function requestMicrophone(): Promise<boolean> {
  if (process.platform === 'darwin') return systemPreferences.askForMediaAccess('microphone')
  return access('microphone') === 'granted'
}

export async function openPrivacySettings(kind: 'microphone' | 'screen'): Promise<void> {
  if (process.platform === 'darwin') {
    const pane = kind === 'microphone' ? 'Privacy_Microphone' : 'Privacy_ScreenCapture'
    await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`)
  } else if (process.platform === 'win32' && kind === 'microphone') {
    await shell.openExternal('ms-settings:privacy-microphone')
  }
}
