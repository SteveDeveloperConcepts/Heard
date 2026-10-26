import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecordingState, Settings, TranscriberStatus } from '../../../shared/types'
import { AudioCapture } from '../audio/capture'
import { VoiceMeter } from '../audio/voiceMeter'
import { cleanIpcError } from '../lib/format'

export interface RecordingController {
  state: RecordingState
  meter: VoiceMeter
  /** The transcription engine's state, e.g. downloading its speech model on first use. */
  engine: TranscriberStatus
  starting: boolean
  error: string | null
  warning: string | null
  start(meetingId: string): Promise<void>
  stop(): Promise<void>
  dismissMessages(): void
}

const IDLE: RecordingState = { active: false, meetingId: null, startedAt: null, priorRecordedMs: 0, sources: [] }

function describeStartError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') {
      return window.api.platform === 'darwin'
        ? 'Microphone access is off for Heard. Allow it in System Settings → Privacy & Security → Microphone.'
        : 'Microphone access was blocked. On Windows, check Settings → Privacy & security → Microphone (desktop apps must be allowed).'
    }
    if (err.name === 'NotFoundError') return 'No microphone was found.'
    if (err.name === 'OverconstrainedError') return 'The selected microphone isn’t available. Pick another in Settings.'
  }
  return cleanIpcError(err)
}

/**
 * Drives one recording at a time: the main process arms capture and starts transcription, then
 * this hook opens the audio devices and forwards PCM. Whenever main reports the recording
 * stopped (Stop button, tray menu, call ended, quit, or a fatal error), the devices are released here.
 */
export function useRecording(settings: Settings | null): RecordingController {
  const [state, setState] = useState<RecordingState>(IDLE)
  const [engine, setEngine] = useState<TranscriberStatus>({ state: 'idle' })
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const captureRef = useRef<AudioCapture | null>(null)
  const meterRef = useRef<VoiceMeter | null>(null)
  meterRef.current ??= new VoiceMeter()
  const meter = meterRef.current

  const releaseDevices = useCallback(async () => {
    const capture = captureRef.current
    captureRef.current = null
    meter.stop()
    if (capture) await capture.stop()
  }, [meter])

  useEffect(() => {
    void window.api.recording.state().then(setState)
    const offState = window.api.recording.onState((next) => {
      setState(next)
      if (!next.active) void releaseDevices()
    })
    const offTranscript = window.api.recording.onTranscript((event) => {
      if (event.kind === 'error') setError(event.message)
      else meter.heardWords(event.kind === 'final' ? event.segment.source : event.source)
    })
    const offEngine = window.api.recording.onTranscriberStatus(setEngine)
    return () => {
      offState()
      offTranscript()
      offEngine()
    }
  }, [releaseDevices, meter])

  const start = useCallback(
    async (meetingId: string) => {
      setError(null)
      setWarning(null)
      setStarting(true)
      try {
        await releaseDevices()
        const armed = await window.api.recording.start(meetingId)
        setState(armed)
        const capture = new AudioCapture({
          onChunk: (source, pcm) => window.api.recording.pushAudio(source, pcm),
          onLevel: (source, level) => meter.pushLevel(source, level),
          onSourceEnded: (source, reason) => {
            window.api.recording.endSource(source)
            meter.pushLevel(source, 0)
            if (source === 'system') setWarning(reason)
            else setError(`Microphone stopped: ${reason}`)
          }
        })
        captureRef.current = capture
        meter.start()
        await capture.start({
          micDeviceId: settings?.micDeviceId ?? null,
          systemAudio: armed.sources.includes('system')
        })
      } catch (err) {
        setError(describeStartError(err))
        await releaseDevices()
        await window.api.recording.stop()
      } finally {
        setStarting(false)
      }
    },
    [settings?.micDeviceId, releaseDevices, meter]
  )

  const stop = useCallback(async () => {
    await releaseDevices()
    await window.api.recording.stop()
  }, [releaseDevices])

  const dismissMessages = useCallback(() => {
    setError(null)
    setWarning(null)
  }, [])

  return { state, meter, engine, starting, error, warning, start, stop, dismissMessages }
}
