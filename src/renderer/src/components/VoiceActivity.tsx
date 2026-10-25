import { useEffect, useRef } from 'react'
import type { AudioSource } from '../../../shared/types'
import { useSpeaking, type VoiceMeter } from '../audio/voiceMeter'

const SHAPE = [0.55, 0.85, 1, 0.75, 0.5]
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

/** A small equalizer that moves with one source's voice. */
export function VoiceBars({ meter, source, height = 16 }: { meter: VoiceMeter; source: AudioSource; height?: number }) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(
    () =>
      meter.onFrame(() => {
        const bars = ref.current?.children
        if (!bars) return
        const level = meter.level(source)
        const t = performance.now() / 1000
        for (let i = 0; i < bars.length; i++) {
          // A little per-bar wobble makes speech look alive; silence settles to a flat line.
          const wobble = reducedMotion.matches ? 1 : 0.7 + 0.3 * Math.sin(t * 9 + i * 1.7)
          const scale = 0.18 + 0.82 * Math.min(1, level * SHAPE[i] * wobble * 1.4)
          ;(bars[i] as HTMLElement).style.transform = `scaleY(${scale.toFixed(3)})`
        }
      }),
    [meter, source]
  )

  return (
    <span className="voice-bars" ref={ref} style={{ height }} aria-hidden="true">
      {SHAPE.map((_, i) => (
        <span key={i} />
      ))}
    </span>
  )
}

/** "Me" / "Them" with live bars; glows while that side is talking. */
export function VoiceChip({
  meter,
  source,
  label,
  tone
}: {
  meter: VoiceMeter
  source: AudioSource
  label: string
  tone: 'dark' | 'light'
}) {
  const speaking = useSpeaking(meter)[source]
  return (
    <span className={`voice-chip voice-chip-${tone}${speaking ? ' speaking' : ''}`} title={speaking ? `${label}: speaking` : `${label}: quiet`}>
      {label}
      <VoiceBars meter={meter} source={source} />
    </span>
  )
}
