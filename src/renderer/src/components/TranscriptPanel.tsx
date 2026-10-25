import { useLayoutEffect, useMemo, useRef } from 'react'
import type { AudioSource, TranscriptSegment } from '../../../shared/types'
import { formatTimestamp, groupTurns } from '../../../shared/transcript'
import type { VoiceMeter } from '../audio/voiceMeter'
import { VoiceChip } from './VoiceActivity'

interface Props {
  segments: TranscriptSegment[]
  interim: Partial<Record<AudioSource, string>>
  live: boolean
  /** Keep the words out of sight until recording stops (they're still transcribed meanwhile). */
  hideWhileLive: boolean
  meter: VoiceMeter
  sources: AudioSource[]
}

function TypingDots() {
  return (
    <span className="typing-dots" aria-label="still listening">
      <span />
      <span />
      <span />
    </span>
  )
}

function ListeningChips({ meter, sources }: { meter: VoiceMeter; sources: AudioSource[] }) {
  return (
    <div className="listening-chips">
      <VoiceChip meter={meter} source="mic" label="Me" tone="light" />
      {sources.includes('system') && <VoiceChip meter={meter} source="system" label="Them" tone="light" />}
    </div>
  )
}

export function TranscriptPanel({ segments, interim, live, hideWhileLive, meter, sources }: Props) {
  const turns = useMemo(() => groupTurns(segments), [segments])
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedToBottom = useRef(true)

  // Follow new speech only while the reader is at the bottom; don't yank them back up-thread.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight
  }, [turns, interim])

  const onScroll = () => {
    const el = scrollRef.current
    if (el) pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const pending = (Object.entries(interim) as [AudioSource, string | undefined][]).filter(([, text]) => text)

  if (live && hideWhileLive) {
    return (
      <div className="listening-empty">
        <ListeningChips meter={meter} sources={sources} />
        <p>
          Listening and transcribing. The transcript appears here when you stop recording.
          {segments.length > 0 && <span className="listening-count">{segments.length} lines so far</span>}
        </p>
      </div>
    )
  }

  if (turns.length === 0 && pending.length === 0) {
    return live ? (
      <div className="listening-empty">
        <ListeningChips meter={meter} sources={sources} />
        <p>Listening. Start talking and the words appear here.</p>
      </div>
    ) : (
      <div className="panel-empty">The transcript appears here after you record.</div>
    )
  }

  return (
    <div className="transcript" ref={scrollRef} onScroll={onScroll}>
      {turns.map((turn) => (
        <div key={turn.id} className={`turn turn-${turn.source}`}>
          <div className="turn-meta">
            <span className="turn-label">{turn.label}</span>
            <span className="turn-time">{formatTimestamp(turn.startMs)}</span>
          </div>
          <p>{turn.text}</p>
        </div>
      ))}
      {pending.map(([source, text]) => (
        <div key={`interim-${source}`} className={`turn turn-${source} interim`}>
          <div className="turn-meta">
            <span className="turn-label">{source === 'mic' ? 'Me' : 'Them'}</span>
            <TypingDots />
          </div>
          <p>{text}</p>
        </div>
      ))}
    </div>
  )
}
