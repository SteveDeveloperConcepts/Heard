// Data shapes shared by the main process, the preload bridge and the renderer.

export type AudioSource = 'mic' | 'system'

export interface TranscriptSegment {
  id: string
  source: AudioSource
  /** Speaker index from diarization; only set for system audio, where several remote voices mix. */
  speaker?: number
  text: string
  /** Milliseconds of recorded time from the start of the meeting's first recording. */
  startMs: number
  endMs: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: string
}

export type TemplateId = 'general' | 'one-on-one' | 'customer-call' | 'standup' | 'interview'

/** Who chose a meeting's title. The AI only names meetings that are untitled or named after a detected call. */
export type TitleSource = 'user' | 'call' | 'ai'

export interface Meeting {
  id: string
  title: string
  /** Missing on meetings saved before titles were tracked; treated as the user's. */
  titleSource?: TitleSource
  createdAt: string
  updatedAt: string
  /** Total recorded time across every recording session of this meeting. */
  recordedMs: number
  /** What the user typed during the meeting. */
  notes: string
  /** Notes written by the AI from `notes` + `transcript`, as Markdown. */
  enhancedNotes: string | null
  /** The model that wrote `enhancedNotes`. */
  enhancedBy?: string | null
  /** The user changed `enhancedNotes` by hand, so they're never replaced automatically. */
  enhancedEdited?: boolean
  /** How many transcript segments `enhancedNotes` were written from. */
  enhancedSegmentCount?: number
  /** A recording ended and its summary isn't written yet; picked up again if the app quit first. */
  summaryPending?: boolean
  template: TemplateId
  transcript: TranscriptSegment[]
  chat: ChatMessage[]
}

export interface MeetingSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  recordedMs: number
  hasEnhancedNotes: boolean
  preview: string
}

export type MeetingPatch = Partial<
  Pick<
    Meeting,
    'title' | 'titleSource' | 'notes' | 'enhancedNotes' | 'enhancedBy' | 'enhancedEdited' | 'enhancedSegmentCount' | 'template'
  >
>

export type MacAudioBackend = 'screencapturekit' | 'coreaudio-tap'

/** Which service writes notes and answers questions. Everything but Anthropic speaks the OpenAI chat API. */
export type AiProviderId = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'ollama' | 'custom'

export type KeyStatus = 'stored' | 'environment' | 'none'

export interface Settings {
  transcriptionEngine: TranscriptionEngine
  localModel: LocalModelSize
  deepgramKey: KeyStatus
  aiProvider: AiProviderId
  aiKeys: Record<AiProviderId, KeyStatus>
  aiModels: Record<AiProviderId, string>
  aiBaseUrls: Record<AiProviderId, string>
  /** When a recording stops, write the notes (with a summary) and name an untitled meeting. */
  autoSummary: boolean
  language: string
  captureSystemAudio: boolean
  micDeviceId: string | null
  macAudioBackend: MacAudioBackend
  /** Google account Gmail drafts open in; empty uses the browser's default account. */
  gmailAccount: string
  /** First line of shared emails, e.g. "Hi all,". */
  emailGreeting: string
  /** Notice when a calling app (WhatsApp, Zoom, …) starts using the microphone and offer to record. */
  callDetection: boolean
  /** Stop a recording that was started from a detected call when that call ends. */
  stopWhenCallEnds: boolean
  /** Show the transcript as it's written; otherwise it appears when recording stops. */
  liveTranscript: boolean
  /** Closing the window leaves Heard running in the tray, still watching for calls. */
  keepInTray: boolean
  /** Start Heard, in the tray, when the user logs in. */
  openAtLogin: boolean
  /** False when running from source, which can't register itself to start at login. */
  openAtLoginAvailable: boolean
}

export interface SettingsUpdate {
  transcriptionEngine?: TranscriptionEngine
  localModel?: LocalModelSize
  /** An empty string removes the stored key. */
  deepgramApiKey?: string
  aiProvider?: AiProviderId
  /** Per-provider API keys; an empty string removes that provider's stored key. */
  aiKeys?: Partial<Record<AiProviderId, string>>
  aiModels?: Partial<Record<AiProviderId, string>>
  /** Only honored for providers whose base URL is editable (Ollama, custom). */
  aiBaseUrls?: Partial<Record<AiProviderId, string>>
  autoSummary?: boolean
  language?: string
  captureSystemAudio?: boolean
  micDeviceId?: string | null
  macAudioBackend?: MacAudioBackend
  gmailAccount?: string
  emailGreeting?: string
  callDetection?: boolean
  stopWhenCallEnds?: boolean
  liveTranscript?: boolean
  keepInTray?: boolean
  openAtLogin?: boolean
}

export interface GmailDraft {
  to: string[]
  subject: string
  /** Plain-text body; Gmail compose links can't carry formatting. */
  text: string
  /** Formatted body, put on the clipboard when the text is too long for a link. */
  html: string
}

export interface ShareResult {
  /** 'prefilled': the draft has the body. 'clipboard': the body was too long and is on the clipboard. */
  mode: 'prefilled' | 'clipboard'
}

/** A call app (WhatsApp, Zoom, …) that started using the microphone. */
export interface CallInfo {
  id: string
  appId: string
  appName: string
  startedAt: number
  /** The meeting recording this call, once the user chose to record it. */
  meetingId: string | null
}

export type CallEvent =
  /** Ask the user whether to record. */
  | { type: 'detected'; call: CallInfo }
  | { type: 'ended'; call: CallInfo }
  /** The user chose Record from the system notification. */
  | { type: 'record'; call: CallInfo }

/** Lists a provider's models using draft values from the settings form, falling back to saved ones. */
export interface ModelListRequest {
  provider: AiProviderId
  baseUrl?: string
  apiKey?: string
}

export interface RecordingState {
  active: boolean
  meetingId: string | null
  /** Epoch ms when the current recording session started. */
  startedAt: number | null
  /** Meeting's recordedMs before this session, so the UI can show a running total. */
  priorRecordedMs: number
  sources: AudioSource[]
}

/** State of the transcription engine; the built-in one downloads its model on first use. */
export type TranscriberStatus =
  | { state: 'idle' }
  | { state: 'downloading'; progress: number; detail: string }
  | { state: 'loading' }
  | { state: 'ready' }
  /** Recording continues, but transcription is behind by this many seconds of audio. */
  | { state: 'behind'; seconds: number }
  | { state: 'error'; message: string }

export type TranscriptionEngine = 'local' | 'deepgram'

/** Built-in Whisper model sizes: bigger is more accurate and slower. */
export type LocalModelSize = 'tiny' | 'base' | 'small'

export type TranscriptEvent =
  | { kind: 'final'; meetingId: string; segment: TranscriptSegment }
  | { kind: 'interim'; meetingId: string; source: AudioSource; text: string }
  | { kind: 'error'; meetingId: string; source: AudioSource; message: string }

export type AiTask = 'enhance' | 'ask' | 'title'

export type AiEvent =
  /** A request began, whoever started it (the user, or a recording that just stopped). */
  | { requestId: string; meetingId: string; task: AiTask; type: 'start' }
  | { requestId: string; meetingId: string; task: AiTask; type: 'delta'; text: string }
  | { requestId: string; meetingId: string; task: AiTask; type: 'done'; text: string }
  | { requestId: string; meetingId: string; task: AiTask; type: 'error'; message: string }

/** Enhanced notes being written right now, so a view opened mid-way can show them. */
export interface AiProgress {
  requestId: string
  text: string
}

export type MediaAccess = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'

export interface PermissionStatus {
  platform: string
  microphone: MediaAccess
  /** macOS screen & system audio recording permission; 'granted' elsewhere. */
  screen: MediaAccess
}

/**
 * A newer Heard on GitHub. `ready`: downloaded, and installed when Heard restarts or quits (Windows).
 * `available`: the user downloads it from its release page (macOS, until the app is signed with a
 * Developer ID).
 */
export interface UpdateState {
  kind: 'ready' | 'available'
  version: string
}
