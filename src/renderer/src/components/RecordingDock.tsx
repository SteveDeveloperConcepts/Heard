import type { TranscriberStatus } from '../../../shared/types'
import type { RecordingController } from '../hooks/useRecording'
import { useNow } from '../hooks/useNow'
import { formatClock, formatDuration } from '../lib/format'
import { Icon } from './Icon'
import { VoiceChip } from './VoiceActivity'

interface Props {
  meetingId: string
  recordedMs: number
  recording: RecordingController
}

/** What the transcription engine is doing, when that's worth showing. */
function EngineStatus({ status }: { status: TranscriberStatus }) {
  if (status.state === 'downloading') {
    return (
      <div className="engine-status" role="status">
        <span>Downloading the speech model (one time only)… {Math.round(status.progress)}%</span>
        <span className="progress" aria-hidden="true">
          <span style={{ width: `${Math.max(2, status.progress)}%` }} />
        </span>
        <span className="hint">Recording has started; the transcript catches up once this finishes.</span>
      </div>
    )
  }
  if (status.state === 'loading') {
    return (
      <div className="engine-status" role="status">
        Starting speech recognition…
      </div>
    )
  }
  if (status.state === 'behind') {
    return (
      <div className="engine-status" role="status">
        Transcript is {Math.round(status.seconds)}s behind. It will catch up; a smaller speech model in Settings is faster.
      </div>
    )
  }
  return null
}

export function RecordingDock({ meetingId, recordedMs, recording }: Props) {
  const { state, meter, engine, starting, error, warning } = recording
  const here = state.active && state.meetingId === meetingId
  const elsewhere = state.active && !here
  const now = useNow(here ? 500 : null)
  const elapsed = here && state.startedAt ? state.priorRecordedMs + (now - state.startedAt) : recordedMs
  const message = error ?? warning

  return (
    <div className="dock-area">
      {message && (
        <div className={`banner ${error ? 'banner-error' : 'banner-warning'}`} role={error ? 'alert' : 'status'}>
          <span>{message}</span>
          <button className="icon-btn" onClick={recording.dismissMessages} aria-label="Dismiss">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {here && <EngineStatus status={engine} />}
      {here ? (
        <div className="dock dock-live">
          <button className="btn btn-rec" onClick={() => void recording.stop()}>
            <span className="stop-square" aria-hidden="true" /> Stop
          </button>
          <span className="dock-time">
            <span className="rec-dot" /> <span className="mono">{formatClock(elapsed)}</span>
          </span>
          <VoiceChip meter={meter} source="mic" label="Me" tone="dark" />
          {state.sources.includes('system') && <VoiceChip meter={meter} source="system" label="Them" tone="dark" />}
        </div>
      ) : (
        <div className="dock dock-idle">
          <button className="btn btn-rec" disabled={starting} onClick={() => void recording.start(meetingId)}>
            <Icon name="mic" /> {starting ? 'Starting…' : elsewhere ? 'Record here' : recordedMs > 0 ? 'Resume recording' : 'Start recording'}
          </button>
          <span className="dock-hint">
            {elsewhere
              ? 'Another meeting is recording. Starting here stops it.'
              : recordedMs > 0
                ? `${formatDuration(recordedMs)} recorded`
                : 'Hears your mic and the call only while recording.'}
          </span>
        </div>
      )}
    </div>
  )
}
