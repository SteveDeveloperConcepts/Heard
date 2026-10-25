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

export interface Meeting {
  id: string
  title: string
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

export type MeetingPatch = Partial<Pick<Meeting, 'title' | 'notes' | 'enhancedNotes' | 'enhancedBy' | 'template'>>

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
  language?: string
  captureSystemAudio?: boolean
  micDeviceId?: string | null
  macAudioBackend?: MacAudioBackend
  gmailAccount?: string
  emailGreeting?: string
  callDetection?: boolean
  stopWhenCallEnds?: boolean
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

export type AiTask = 'enhance' | 'ask'

export type AiEvent =
  | { requestId: string; meetingId: string; task: AiTask; type: 'delta'; text: string }
  | { requestId: string; meetingId: string; task: AiTask; type: 'done'; text: string }
  | { requestId: string; meetingId: string; task: AiTask; type: 'error'; message: string }

export type MediaAccess = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'

export interface PermissionStatus {
  platform: string
  microphone: MediaAccess
  /** macOS screen & system audio recording permission; 'granted' elsewhere. */
  screen: MediaAccess
}
