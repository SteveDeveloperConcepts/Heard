import { SAMPLE_RATE, SpeechSegmenter, type Segment } from './segmenter'
import type { LiveTranscriber, TranscriberCallbacks } from './types'
import { whisperEngine } from './whisper-engine'

// Built-in engine: segments each source's audio at pauses and transcribes every utterance with
// Whisper on this computer. While someone is mid-sentence it also shows a rough interim result,
// but only when the engine has nothing more important to do.

const INTERIM_EVERY_MS = 1500
const MIN_INTERIM_SECONDS = 1.2

export interface LocalTranscriberOptions extends TranscriberCallbacks {
  /** Two-letter language code, or null to auto-detect. */
  language: string | null
}

/** Whisper marks non-speech as e.g. "[BLANK_AUDIO]" or "(music)"; those aren't words. */
function cleanTranscript(text: string): string {
  const trimmed = text.trim()
  if (/^[\s.,!?…-]*$/.test(trimmed)) return ''
  if (/^(\[[^\]]*\]|\([^)]*\)|\s)+$/.test(trimmed)) return ''
  return trimmed
}

export class LocalLiveTranscriber implements LiveTranscriber {
  private readonly segmenter: SpeechSegmenter
  private readonly pending = new Set<Promise<void>>()
  private readonly interimTimer: NodeJS.Timeout
  private lastInterimAt = 0
  private interimBusy = false
  private finished = false
  private failed = false

  constructor(private readonly options: LocalTranscriberOptions) {
    this.segmenter = new SpeechSegmenter((segment) => this.transcribeUtterance(segment))
    this.interimTimer = setInterval(() => this.maybeInterim(), 500)
  }

  send(pcm: Buffer): void {
    if (this.finished || this.failed) return
    // Copy so the samples are 2-byte aligned whatever the Buffer's offset.
    const samples = new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength))
    const floats = new Float32Array(samples.length)
    for (let i = 0; i < samples.length; i++) floats[i] = samples[i] / 32768
    this.segmenter.push(floats)
  }

  async finish(): Promise<void> {
    if (this.finished) return
    this.segmenter.flush()
    this.finished = true
    clearInterval(this.interimTimer)
    await Promise.allSettled([...this.pending])
  }

  private transcribeUtterance(segment: Segment): void {
    const job = whisperEngine
      .transcribe(segment.audio, this.options.language)
      .then((text) => {
        const clean = cleanTranscript(text)
        if (clean) {
          this.options.onFinal({ text: clean, start: segment.startSample / SAMPLE_RATE, end: segment.endSample / SAMPLE_RATE })
        }
      })
      .catch((err: unknown) => this.fail(err))
    this.pending.add(job)
    void job.finally(() => this.pending.delete(job))
  }

  private maybeInterim(): void {
    if (this.finished || this.failed || this.interimBusy || !whisperEngine.isIdle()) return
    if (Date.now() - this.lastInterimAt < INTERIM_EVERY_MS) return
    const partial = this.segmenter.partial()
    if (!partial || partial.audio.length < SAMPLE_RATE * MIN_INTERIM_SECONDS) return

    const generation = this.segmenter.generation
    this.interimBusy = true
    this.lastInterimAt = Date.now()
    whisperEngine
      .transcribe(partial.audio, this.options.language)
      .then((text) => {
        // Once the utterance has finished, its final result supersedes this one.
        const clean = cleanTranscript(text)
        if (clean && !this.finished && this.segmenter.generation === generation) this.options.onInterim(clean)
      })
      .catch(() => {
        // Interim results are best-effort.
      })
      .finally(() => {
        this.interimBusy = false
      })
  }

  private fail(err: unknown): void {
    if (this.failed || this.finished) return
    this.failed = true
    clearInterval(this.interimTimer)
    this.options.onFailure(err instanceof Error ? err.message : String(err), false)
  }
}
