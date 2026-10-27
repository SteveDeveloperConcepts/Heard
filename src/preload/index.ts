import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { HeardApi } from '../shared/api'
import { IPC } from '../shared/ipc'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: HeardApi = {
  platform: process.platform,
  meetings: {
    list: () => ipcRenderer.invoke(IPC.meetingsList),
    get: (id) => ipcRenderer.invoke(IPC.meetingsGet, id),
    create: () => ipcRenderer.invoke(IPC.meetingsCreate),
    update: (id, patch) => ipcRenderer.invoke(IPC.meetingsUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC.meetingsRemove, id)
  },
  recording: {
    start: (meetingId) => ipcRenderer.invoke(IPC.recordingStart, meetingId),
    stop: () => ipcRenderer.invoke(IPC.recordingStop),
    state: () => ipcRenderer.invoke(IPC.recordingState),
    pushAudio: (source, pcm) => ipcRenderer.send(IPC.recordingAudio, source, pcm),
    endSource: (source) => ipcRenderer.send(IPC.recordingEndSource, source),
    onState: (cb) => subscribe(IPC.recordingStateChanged, cb),
    onTranscript: (cb) => subscribe(IPC.transcriptEvent, cb),
    onTranscriberStatus: (cb) => subscribe(IPC.transcriberStatus, cb),
    prepareTranscriber: () => ipcRenderer.invoke(IPC.transcriberPrepare)
  },
  ai: {
    enhance: (meetingId) => ipcRenderer.invoke(IPC.aiEnhance, meetingId),
    ask: (meetingId, question) => ipcRenderer.invoke(IPC.aiAsk, meetingId, question),
    cancel: (requestId) => ipcRenderer.send(IPC.aiCancel, requestId),
    progress: (meetingId) => ipcRenderer.invoke(IPC.aiProgress, meetingId),
    onEvent: (cb) => subscribe(IPC.aiEvent, cb),
    listModels: (request) => ipcRenderer.invoke(IPC.aiListModels, request)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (update) => ipcRenderer.invoke(IPC.settingsUpdate, update)
  },
  permissions: {
    status: () => ipcRenderer.invoke(IPC.permissionsStatus),
    requestMicrophone: () => ipcRenderer.invoke(IPC.permissionsRequestMic),
    openSystemSettings: (kind) => ipcRenderer.invoke(IPC.permissionsOpen, kind)
  },
  calls: {
    current: () => ipcRenderer.invoke(IPC.callsCurrent),
    link: (callId, meetingId, appName) => ipcRenderer.invoke(IPC.callsLink, callId, meetingId, appName),
    onEvent: (cb) => subscribe(IPC.callsEvent, cb)
  },
  share: {
    copy: (content) => ipcRenderer.invoke(IPC.shareCopy, content),
    openGmail: (draft) => ipcRenderer.invoke(IPC.shareGmail, draft)
  },
  update: {
    state: () => ipcRenderer.invoke(IPC.updateState),
    onState: (cb) => subscribe(IPC.updateStateChanged, cb),
    install: () => ipcRenderer.invoke(IPC.updateInstall)
  },
  openDataFolder: () => ipcRenderer.invoke(IPC.openDataFolder)
}

contextBridge.exposeInMainWorld('api', api)
