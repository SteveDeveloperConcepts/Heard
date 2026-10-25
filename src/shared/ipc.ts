// IPC channel names, shared so main and preload can't drift apart.
export const IPC = {
  meetingsList: 'meetings:list',
  meetingsGet: 'meetings:get',
  meetingsCreate: 'meetings:create',
  meetingsUpdate: 'meetings:update',
  meetingsRemove: 'meetings:remove',

  recordingStart: 'recording:start',
  recordingStop: 'recording:stop',
  recordingState: 'recording:state',
  recordingAudio: 'recording:audio',
  recordingEndSource: 'recording:end-source',
  recordingStateChanged: 'recording:state-changed',
  transcriptEvent: 'transcript:event',
  transcriberStatus: 'transcriber:status',
  transcriberPrepare: 'transcriber:prepare',

  aiEnhance: 'ai:enhance',
  aiAsk: 'ai:ask',
  aiCancel: 'ai:cancel',
  aiProgress: 'ai:progress',
  aiEvent: 'ai:event',
  aiListModels: 'ai:list-models',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',

  permissionsStatus: 'permissions:status',
  permissionsRequestMic: 'permissions:request-mic',
  permissionsOpen: 'permissions:open',

  callsEvent: 'calls:event',
  callsCurrent: 'calls:current',
  callsLink: 'calls:link',

  shareCopy: 'share:copy',
  shareGmail: 'share:gmail',

  openDataFolder: 'app:open-data-folder'
} as const
