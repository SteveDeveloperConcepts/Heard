import { BrowserWindow, Notification } from 'electron'
import { IPC } from '../../shared/ipc'
import type { CallEvent, CallInfo } from '../../shared/types'
import { aiReady } from '../ai'
import { getMeeting, updateMeeting } from '../meetings'
import { recorder } from '../recorder'
import { loadSettings } from '../settings'
import { CALL_APPS } from './apps'
import { callDetector } from './detector'

// Turns detected calls into a question for the user. Nothing records until they answer Record,
// in the app or on the notification.

let notification: Notification | null = null

function broadcast(event: CallEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.callsEvent, event)
  }
}

function notify(title: string, body: string, options: { record?: CallInfo; onClick?: () => void } = {}): void {
  if (!Notification.isSupported()) return
  notification?.close()
  const n = new Notification({
    title,
    body,
    // Buttons on notifications are macOS-only; elsewhere a click opens the app's prompt.
    actions: options.record && process.platform === 'darwin' ? [{ type: 'button', text: 'Record' }] : []
  })
  n.on('click', () => options.onClick?.())
  n.on('action', () => {
    options.onClick?.()
    if (options.record) broadcast({ type: 'record', call: options.record })
  })
  n.show()
  notification = n
}

/** The call still waiting for an answer: one nobody is recording, while nothing else is. */
export function pendingCall(): CallInfo | null {
  if (recorder.isActive()) return null
  return callDetector.list().find((c) => c.meetingId === null) ?? null
}

/**
 * Ties a call to the meeting recording it, and names the meeting after the call's app until the AI
 * gives it a better title. `appName` covers a call that already ended, e.g. Record clicked late on
 * its notification; only known app names are used.
 */
export async function linkCall(callId: string, meetingId: string, appName: string): Promise<void> {
  callDetector.link(callId, meetingId)
  const name = callDetector.list().find((c) => c.id === callId)?.appName ?? CALL_APPS.find((app) => app.name === appName)?.name
  const meeting = await getMeeting(meetingId)
  if (name && meeting && !meeting.title.trim()) {
    await updateMeeting(meetingId, { title: `${name} call`, titleSource: 'call' })
  }
}

/** Starts or stops watching for calls to match the user's setting. */
export function applyCallDetectionSetting(): void {
  if (loadSettings().callDetection) callDetector.start()
  else callDetector.stop()
}

export function setupCallDetection(showWindow: () => void): void {
  callDetector.on('started', (call) => {
    if (recorder.isActive()) return
    broadcast({ type: 'detected', call })
    notify(`${call.appName} call detected`, 'Record and transcribe it? Let everyone on the call know first.', {
      record: call,
      onClick: showWindow
    })
  })

  callDetector.on('ended', (call) => {
    broadcast({ type: 'ended', call })
    const recordingThisCall = call.meetingId !== null && recorder.state().meetingId === call.meetingId
    // On macOS before 14.2 our own recording keeps the mic "in use", so an end can't be trusted.
    if (recordingThisCall && loadSettings().stopWhenCallEnds && callDetector.knowsWhichApp) {
      void recorder.stop()
      const next = loadSettings().autoSummary && aiReady() ? 'The summary will be ready in a moment.' : 'Your notes are ready to enhance.'
      notify(`${call.appName} call ended`, `Recording stopped. ${next}`, { onClick: showWindow })
    }
  })

  applyCallDetectionSetting()
}

export function stopCallDetection(): void {
  callDetector.stop()
}
