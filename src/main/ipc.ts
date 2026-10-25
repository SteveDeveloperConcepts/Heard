import { BrowserWindow, ipcMain, shell } from 'electron'
import { mkdir } from 'node:fs/promises'
import { IPC } from '../shared/ipc'
import { AI_PROVIDER_IDS, isAiProviderId } from '../shared/providers'
import type {
  AiEvent,
  AiProviderId,
  AudioSource,
  GmailDraft,
  MeetingPatch,
  ModelListRequest,
  SettingsUpdate,
  TemplateId
} from '../shared/types'
import {
  askAboutMeeting,
  cancelAi,
  cancelMeetingAi,
  enhanceNotes,
  enhanceProgress,
  listModels,
  resumeSummaries,
  summarizeRecording
} from './ai'
import { applyCallDetectionSetting, linkCall, pendingCall } from './calls'
import { createMeeting, deleteMeeting, getMeeting, listMeetings, meetingsDir, updateMeeting } from './meetings'
import { openPrivacySettings, permissionStatus, requestMicrophone } from './media'
import { recorder } from './recorder'
import { applyOpenAtLogin } from './startup'
import { loadSettings, publicSettings, updateSettings } from './settings'
import { whisperEngine } from './transcription/whisper-engine'
import { copyToClipboard, openGmailDraft } from './share'

const SOURCES: readonly AudioSource[] = ['mic', 'system']
const TEMPLATES: readonly TemplateId[] = ['general', 'one-on-one', 'customer-call', 'standup', 'interview']

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function asString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} must be a string`)
  return value
}

function asSource(value: unknown): AudioSource {
  if (!SOURCES.includes(value as AudioSource)) throw new Error('Unknown audio source')
  return value as AudioSource
}

function asPatch(value: unknown): MeetingPatch {
  const raw = (value ?? {}) as Record<string, unknown>
  const patch: MeetingPatch = {}
  if (typeof raw.title === 'string') patch.title = raw.title
  if (typeof raw.notes === 'string') patch.notes = raw.notes
  if (typeof raw.enhancedNotes === 'string' || raw.enhancedNotes === null) patch.enhancedNotes = raw.enhancedNotes
  // Notes changed from the window are the user's, so they're never replaced automatically.
  if (typeof raw.enhancedNotes === 'string') patch.enhancedEdited = raw.enhancedNotes.trim() !== ''
  if (TEMPLATES.includes(raw.template as TemplateId)) patch.template = raw.template as TemplateId
  return patch
}

/** Keeps only string values for known providers. */
function asProviderStrings(value: unknown): Partial<Record<AiProviderId, string>> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const result: Partial<Record<AiProviderId, string>> = {}
  for (const p of AI_PROVIDER_IDS) {
    if (typeof raw[p] === 'string') result[p] = raw[p]
  }
  return result
}

function asSettingsUpdate(value: unknown): SettingsUpdate {
  const raw = (value ?? {}) as Record<string, unknown>
  const update: SettingsUpdate = {}
  if (raw.transcriptionEngine === 'local' || raw.transcriptionEngine === 'deepgram') update.transcriptionEngine = raw.transcriptionEngine
  if (raw.localModel === 'tiny' || raw.localModel === 'base' || raw.localModel === 'small') update.localModel = raw.localModel
  if (typeof raw.deepgramApiKey === 'string') update.deepgramApiKey = raw.deepgramApiKey
  if (isAiProviderId(raw.aiProvider)) update.aiProvider = raw.aiProvider
  if (typeof raw.autoSummary === 'boolean') update.autoSummary = raw.autoSummary
  update.aiKeys = asProviderStrings(raw.aiKeys)
  update.aiModels = asProviderStrings(raw.aiModels)
  update.aiBaseUrls = asProviderStrings(raw.aiBaseUrls)
  if (typeof raw.language === 'string') update.language = raw.language
  if (typeof raw.captureSystemAudio === 'boolean') update.captureSystemAudio = raw.captureSystemAudio
  if (typeof raw.micDeviceId === 'string' || raw.micDeviceId === null) update.micDeviceId = raw.micDeviceId
  if (raw.macAudioBackend === 'screencapturekit' || raw.macAudioBackend === 'coreaudio-tap') {
    update.macAudioBackend = raw.macAudioBackend
  }
  if (typeof raw.gmailAccount === 'string') update.gmailAccount = raw.gmailAccount
  if (typeof raw.emailGreeting === 'string') update.emailGreeting = raw.emailGreeting
  if (typeof raw.callDetection === 'boolean') update.callDetection = raw.callDetection
  if (typeof raw.stopWhenCallEnds === 'boolean') update.stopWhenCallEnds = raw.stopWhenCallEnds
  if (typeof raw.liveTranscript === 'boolean') update.liveTranscript = raw.liveTranscript
  if (typeof raw.keepInTray === 'boolean') update.keepInTray = raw.keepInTray
  if (typeof raw.openAtLogin === 'boolean') update.openAtLogin = raw.openAtLogin
  return update
}

function asShareContent(value: unknown): { text: string; html?: string } {
  const raw = (value ?? {}) as Record<string, unknown>
  return {
    text: asString(raw.text, 'text'),
    html: typeof raw.html === 'string' ? raw.html : undefined
  }
}

function asGmailDraft(value: unknown): GmailDraft {
  const raw = (value ?? {}) as Record<string, unknown>
  const to = Array.isArray(raw.to) ? raw.to.filter((a): a is string => typeof a === 'string') : []
  return {
    to,
    subject: typeof raw.subject === 'string' ? raw.subject : '',
    text: asString(raw.text, 'text'),
    html: typeof raw.html === 'string' ? raw.html : ''
  }
}

export function registerIpc(): void {
  const emitAi = (event: AiEvent): void => broadcast(IPC.aiEvent, event)
  recorder.on('state', (state) => broadcast(IPC.recordingStateChanged, state))
  recorder.on('transcript', (event) => broadcast(IPC.transcriptEvent, event))
  recorder.on('finished', (meetingId, summarize) => {
    if (summarize && loadSettings().autoSummary) void summarizeRecording(meetingId, emitAi)
  })
  whisperEngine.on('status', (status) => broadcast(IPC.transcriberStatus, status))

  ipcMain.handle(IPC.meetingsList, () => listMeetings())
  ipcMain.handle(IPC.meetingsGet, (_e, id) => getMeeting(asString(id, 'id')))
  ipcMain.handle(IPC.meetingsCreate, () => createMeeting())
  ipcMain.handle(IPC.meetingsUpdate, (_e, id, patch) => updateMeeting(asString(id, 'id'), asPatch(patch)))
  ipcMain.handle(IPC.meetingsRemove, async (_e, id) => {
    const meetingId = asString(id, 'id')
    if (recorder.state().meetingId === meetingId) await recorder.stop({ summarize: false })
    cancelMeetingAi(meetingId)
    await deleteMeeting(meetingId)
  })

  ipcMain.handle(IPC.recordingStart, (_e, id) => recorder.start(asString(id, 'id')))
  ipcMain.handle(IPC.recordingStop, () => recorder.stop())
  ipcMain.handle(IPC.recordingState, () => recorder.state())
  ipcMain.on(IPC.recordingAudio, (_e, source, pcm) => {
    if (pcm instanceof ArrayBuffer) recorder.push(asSource(source), pcm)
  })
  ipcMain.on(IPC.recordingEndSource, (_e, source) => recorder.endSource(asSource(source)))
  ipcMain.handle(IPC.transcriberPrepare, () => {
    const settings = loadSettings()
    whisperEngine.prepare(settings.localModel, settings.language)
  })

  ipcMain.handle(IPC.aiEnhance, (_e, id) => enhanceNotes(asString(id, 'id'), emitAi))
  ipcMain.handle(IPC.aiAsk, (_e, id, question) => askAboutMeeting(asString(id, 'id'), asString(question, 'question'), emitAi))
  ipcMain.on(IPC.aiCancel, (_e, requestId) => cancelAi(asString(requestId, 'requestId')))
  ipcMain.handle(IPC.aiProgress, (_e, id) => enhanceProgress(asString(id, 'id')))
  ipcMain.handle(IPC.aiListModels, (_e, request: ModelListRequest) => {
    if (!isAiProviderId(request?.provider)) throw new Error('Unknown AI provider')
    return listModels({
      provider: request.provider,
      baseUrl: typeof request.baseUrl === 'string' ? request.baseUrl : undefined,
      apiKey: typeof request.apiKey === 'string' ? request.apiKey : undefined
    })
  })

  ipcMain.handle(IPC.settingsGet, () => publicSettings())
  ipcMain.handle(IPC.settingsUpdate, (_e, update) => {
    const wasOpenAtLogin = loadSettings().openAtLogin
    const settings = updateSettings(asSettingsUpdate(update))
    applyCallDetectionSetting()
    // Only on a change, so turning it off in Windows' or macOS's own startup settings sticks.
    if (settings.openAtLogin !== wasOpenAtLogin) applyOpenAtLogin()
    return settings
  })

  ipcMain.handle(IPC.callsCurrent, () => pendingCall())
  ipcMain.handle(IPC.callsLink, (_e, callId, meetingId, appName) =>
    linkCall(asString(callId, 'callId'), asString(meetingId, 'meetingId'), typeof appName === 'string' ? appName : '')
  )

  ipcMain.handle(IPC.permissionsStatus, () => permissionStatus())
  ipcMain.handle(IPC.permissionsRequestMic, () => requestMicrophone())
  ipcMain.handle(IPC.permissionsOpen, (_e, kind) => openPrivacySettings(kind === 'screen' ? 'screen' : 'microphone'))

  ipcMain.handle(IPC.shareCopy, (_e, content) => copyToClipboard(asShareContent(content)))
  ipcMain.handle(IPC.shareGmail, (_e, draft) => openGmailDraft(asGmailDraft(draft)))

  ipcMain.handle(IPC.openDataFolder, async () => {
    await mkdir(meetingsDir(), { recursive: true })
    await shell.openPath(meetingsDir())
  })

  void resumeSummaries(emitAi)
}
