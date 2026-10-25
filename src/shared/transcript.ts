import type { TranscriptSegment } from './types'

export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** True when diarization found more than one voice in the system audio. */
export function hasMultipleRemoteSpeakers(segments: TranscriptSegment[]): boolean {
  const speakers = new Set<number>()
  for (const s of segments) {
    if (s.source === 'system' && s.speaker !== undefined) speakers.add(s.speaker)
    if (speakers.size > 1) return true
  }
  return false
}

export function speakerLabel(segment: Pick<TranscriptSegment, 'source' | 'speaker'>, multipleRemote: boolean): string {
  if (segment.source === 'mic') return 'Me'
  if (multipleRemote && segment.speaker !== undefined) return `Speaker ${segment.speaker + 1}`
  return 'Them'
}

export interface TranscriptTurn {
  id: string
  label: string
  source: TranscriptSegment['source']
  startMs: number
  text: string
}

/** Merges consecutive segments from the same speaker into turns, ordered by time. */
export function groupTurns(segments: TranscriptSegment[]): TranscriptTurn[] {
  const multipleRemote = hasMultipleRemoteSpeakers(segments)
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs)
  const turns: TranscriptTurn[] = []
  for (const seg of sorted) {
    const label = speakerLabel(seg, multipleRemote)
    const last = turns[turns.length - 1]
    if (last && last.label === label) {
      last.text += ` ${seg.text}`
    } else {
      turns.push({ id: seg.id, label, source: seg.source, startMs: seg.startMs, text: seg.text })
    }
  }
  return turns
}

export function transcriptToText(segments: TranscriptSegment[]): string {
  return groupTurns(segments)
    .map((t) => `[${formatTimestamp(t.startMs)}] ${t.label}: ${t.text}`)
    .join('\n')
}
