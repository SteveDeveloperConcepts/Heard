import type {
  AiEvent,
  AiProgress,
  AudioSource,
  CallEvent,
  CallInfo,
  GmailDraft,
  Meeting,
  MeetingPatch,
  MeetingSummary,
  ModelListRequest,
  PermissionStatus,
  RecordingState,
  Settings,
  SettingsUpdate,
  ShareResult,
  TranscriberStatus,
  TranscriptEvent
} from './types'

type Unsubscribe = () => void

/** The API the preload script exposes to the renderer as `window.api`. */
export interface SteveNolaApi {
  platform: string
  meetings: {
    list(): Promise<MeetingSummary[]>
    get(id: string): Promise<Meeting | null>
    create(): Promise<Meeting>
    update(id: string, patch: MeetingPatch): Promise<Meeting>
    remove(id: string): Promise<void>
  }
  recording: {
    /** Arms audio capture and opens transcription streams. Capture is refused unless this was called. */
    start(meetingId: string): Promise<RecordingState>
    stop(): Promise<RecordingState>
    state(): Promise<RecordingState>
    pushAudio(source: AudioSource, pcm: ArrayBuffer): void
    /** Tells main a source stopped producing audio (e.g. system audio was unavailable). */
    endSource(source: AudioSource): void
    onState(cb: (state: RecordingState) => void): Unsubscribe
    onTranscript(cb: (event: TranscriptEvent) => void): Unsubscribe
    onTranscriberStatus(cb: (status: TranscriberStatus) => void): Unsubscribe
    /** Downloads and loads the built-in speech model now, instead of on the first recording. */
    prepareTranscriber(): Promise<void>
  }
  ai: {
    /** Starts writing enhanced notes; returns a request id whose progress arrives via onEvent. */
    enhance(meetingId: string): Promise<string>
    ask(meetingId: string, question: string): Promise<string>
    cancel(requestId: string): void
    /** Enhanced notes being written for this meeting right now, if any. */
    progress(meetingId: string): Promise<AiProgress | null>
    onEvent(cb: (event: AiEvent) => void): Unsubscribe
    listModels(request: ModelListRequest): Promise<string[]>
  }
  settings: {
    get(): Promise<Settings>
    update(update: SettingsUpdate): Promise<Settings>
  }
  permissions: {
    status(): Promise<PermissionStatus>
    requestMicrophone(): Promise<boolean>
    openSystemSettings(kind: 'microphone' | 'screen'): Promise<void>
  }
  calls: {
    /** A detected call still waiting for the user's answer, if any. */
    current(): Promise<CallInfo | null>
    /**
     * Ties a call to the meeting recording it, so the recording can stop when the call ends, and
     * names an untitled meeting after the call's app.
     */
    link(callId: string, meetingId: string, appName: string): Promise<void>
    onEvent(cb: (event: CallEvent) => void): Unsubscribe
  }
  share: {
    /** Puts text (and formatting, when given) on the clipboard, ready to paste into an email. */
    copy(content: { text: string; html?: string }): Promise<void>
    /** Opens a Gmail draft in the browser. Nothing is sent until the user presses Send there. */
    openGmail(draft: GmailDraft): Promise<ShareResult>
  }
  openDataFolder(): Promise<void>
}
