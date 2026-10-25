import { useSyncExternalStore } from 'react'
import type { AudioSource } from '../../../shared/types'

const SOURCES: AudioSource[] = ['mic', 'system']
// RMS thresholds with hysteresis: speech starts above ON and keeps going until below OFF.
const ON_RMS = 0.02
const OFF_RMS = 0.01
// Keep "speaking" briefly through the gaps between words.
const HANGOVER_MS = 400
// Words from the transcriber also count as speech, for this long after they arrive.
const WORDS_HOLD_MS = 1200

type PerSource<T> = Record<AudioSource, T>

/**
 * Turns raw input levels into smooth display levels and a "who's speaking" signal, updated once
 * per display frame. Animations subscribe to frames and write styles directly, so 60 fps of
 * motion causes no React renders; only speaking on/off changes re-render.
 */
export class VoiceMeter {
  private raw: PerSource<number> = { mic: 0, system: 0 }
  private display: PerSource<number> = { mic: 0, system: 0 }
  private loudUntil: PerSource<number> = { mic: 0, system: 0 }
  private wordsUntil: PerSource<number> = { mic: 0, system: 0 }
  private speakingState: PerSource<boolean> = { mic: false, system: false }
  private frameListeners = new Set<() => void>()
  private speakingListeners = new Set<() => void>()
  private rafId = 0

  pushLevel(source: AudioSource, rms: number): void {
    this.raw[source] = rms
  }

  heardWords(source: AudioSource): void {
    this.wordsUntil[source] = performance.now() + WORDS_HOLD_MS
  }

  start(): void {
    if (this.rafId) return
    const tick = (now: number) => {
      this.frame(now)
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  stop(): void {
    cancelAnimationFrame(this.rafId)
    this.rafId = 0
    for (const s of SOURCES) {
      this.raw[s] = 0
      this.display[s] = 0
      this.loudUntil[s] = 0
      this.wordsUntil[s] = 0
    }
    this.setSpeaking({ mic: false, system: false })
    this.frameListeners.forEach((fn) => fn())
  }

  /** Display level, 0–1. */
  level(source: AudioSource): number {
    return this.display[source]
  }

  onFrame(listener: () => void): () => void {
    this.frameListeners.add(listener)
    return () => {
      this.frameListeners.delete(listener)
    }
  }

  subscribeSpeaking = (listener: () => void): (() => void) => {
    this.speakingListeners.add(listener)
    return () => {
      this.speakingListeners.delete(listener)
    }
  }

  getSpeaking = (): PerSource<boolean> => this.speakingState

  private setSpeaking(next: PerSource<boolean>): void {
    if (next.mic === this.speakingState.mic && next.system === this.speakingState.system) return
    this.speakingState = next
    this.speakingListeners.forEach((fn) => fn())
  }

  private frame(now: number): void {
    const speaking: PerSource<boolean> = { mic: false, system: false }
    for (const s of SOURCES) {
      // Speech RMS sits around 0.02–0.2; a square root spreads it across the display range.
      const target = Math.min(1, Math.sqrt(this.raw[s]) * 2.4)
      const rate = target > this.display[s] ? 0.5 : 0.12 // fast attack, slow release
      this.display[s] += (target - this.display[s]) * rate
      const threshold = this.speakingState[s] ? OFF_RMS : ON_RMS
      if (this.raw[s] >= threshold) this.loudUntil[s] = now + HANGOVER_MS
      speaking[s] = now < this.loudUntil[s] || now < this.wordsUntil[s]
    }
    this.setSpeaking(speaking)
    this.frameListeners.forEach((fn) => fn())
  }
}

export function useSpeaking(meter: VoiceMeter): PerSource<boolean> {
  return useSyncExternalStore(meter.subscribeSpeaking, meter.getSpeaking)
}
