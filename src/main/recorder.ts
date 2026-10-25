import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { AudioSource, RecordingState, TranscriptEvent, TranscriptSegment, TranscriptionEngine } from '../shared/types'
import { DeepgramLiveTranscriber } from './transcription/deepgram'
import { LocalLiveTranscriber } from './transcription/local'
import type { LiveTranscriber, TranscriberCallbacks } from './transcription/types'
import { whisperEngine } from './transcription/whisper-engine'
import { addRecordedTime, appendSegment, getMeeting } from './meetings'
import { getSecret, loadSettings } from './settings'
import { setCaptureArmed } from './media'

const MAX_RECONNECTS = 3

interface Session {
  meetingId: string
  startedAt: number
  priorRecordedMs: number
  engine: TranscriptionEngine
  /** Deepgram only. */
  apiKey: string | null
  language: string
  streams: Map<AudioSource, LiveTranscriber>
  reconnects: Map<AudioSource, number>
}

interface RecorderEvents {
  state: [RecordingState]
  transcript: [TranscriptEvent]
}

/**
 * Owns the one active recording session: arms capture in the main process, routes PCM from the
 * renderer to a transcription stream per source, and saves final transcript segments.
 */
class Recorder extends EventEmitter<RecorderEvents> {
  private session: Session | null = null

  state(): RecordingState {
    const s = this.session
    return {
      active: s !== null,
      meetingId: s?.meetingId ?? null,
      startedAt: s?.startedAt ?? null,
      priorRecordedMs: s?.priorRecordedMs ?? 0,
      sources: s ? [...s.streams.keys()] : []
    }
  }

  isActive(): boolean {
    return this.session !== null
  }

  async start(meetingId: string): Promise<RecordingState> {
    if (this.session?.meetingId === meetingId) return this.state()
    if (this.session) await this.stop()

    const meeting = await getMeeting(meetingId)
    if (!meeting) throw new Error('Meeting not found.')

    const settings = loadSettings()
    const engine = settings.transcriptionEngine
    let apiKey: string | null = null
    if (engine === 'deepgram') {
      apiKey = getSecret('deepgram')
      if (!apiKey) throw new Error('Add your Deepgram API key in Settings, or switch to built-in transcription.')
    } else {
      // Loads (or, the first time, downloads) the speech model while recording begins.
      whisperEngine.prepare(settings.localModel, settings.language)
    }

    const session: Session = {
      meetingId,
      startedAt: Date.now(),
      priorRecordedMs: meeting.recordedMs,
      engine,
      apiKey,
      language: settings.language,
      streams: new Map(),
      reconnects: new Map()
    }
    this.session = session
    const sources: AudioSource[] = settings.captureSystemAudio ? ['mic', 'system'] : ['mic']
    for (const source of sources) session.streams.set(source, this.openStream(session, source))

    setCaptureArmed(true)
    this.emit('state', this.state())
    return this.state()
  }

  private openStream(session: Session, source: AudioSource): LiveTranscriber {
    // Stream timestamps start at zero; anchor them to the meeting's timeline.
    const offsetMs = session.priorRecordedMs + (Date.now() - session.startedAt)
    const { meetingId } = session
    const callbacks: TranscriberCallbacks = {
      onFinal: (result) => {
        session.reconnects.set(source, 0)
        const segment: TranscriptSegment = {
          id: randomUUID(),
          source,
          speaker: result.speaker,
          text: result.text,
          startMs: Math.round(offsetMs + result.start * 1000),
          endMs: Math.round(offsetMs + result.end * 1000)
        }
        appendSegment(meetingId, segment).catch((err) => console.error('Failed to save transcript segment:', err))
        this.emit('transcript', { kind: 'final', meetingId, segment })
      },
      onInterim: (text) => this.emit('transcript', { kind: 'interim', meetingId, source, text }),
      onFailure: (message, retryable) => this.handleFailure(session, source, message, retryable)
    }
    if (session.engine === 'deepgram') {
      return new DeepgramLiveTranscriber({ apiKey: session.apiKey ?? '', language: session.language, diarize: source === 'system', ...callbacks })
    }
    return new LocalLiveTranscriber({ language: session.language === 'multi' ? null : session.language, ...callbacks })
  }

  private handleFailure(session: Session, source: AudioSource, message: string, retryable: boolean): void {
    if (this.session !== session) return
    const attempts = (session.reconnects.get(source) ?? 0) + 1
    session.reconnects.set(source, attempts)
    if (retryable && attempts <= MAX_RECONNECTS) {
      console.warn(`Reconnecting ${source} transcription (attempt ${attempts}): ${message}`)
      session.streams.set(source, this.openStream(session, source))
      return
    }
    this.emit('transcript', { kind: 'error', meetingId: session.meetingId, source, message })
    this.endSource(source)
  }

  push(source: AudioSource, pcm: ArrayBuffer): void {
    this.session?.streams.get(source)?.send(Buffer.from(pcm))
  }

  /** Stops transcribing one source; stops the whole recording if none are left. */
  endSource(source: AudioSource): void {
    const session = this.session
    const stream = session?.streams.get(source)
    if (!session || !stream) return
    session.streams.delete(source)
    void stream.finish()
    if (session.streams.size === 0) void this.stop()
    else this.emit('state', this.state())
  }

  async stop(): Promise<RecordingState> {
    const session = this.session
    if (!session) return this.state()
    // Disarm first so no new capture can start while the streams flush.
    this.session = null
    setCaptureArmed(false)
    await addRecordedTime(session.meetingId, Date.now() - session.startedAt)
    this.emit('state', this.state())
    // Results for audio already sent keep arriving until each stream closes; they are still saved.
    await Promise.all([...session.streams.values()].map((stream) => stream.finish()))
    return this.state()
  }
}

export const recorder = new Recorder()
