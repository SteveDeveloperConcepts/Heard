// Cuts a continuous 16 kHz stream into utterances at pauses, so Whisper (which transcribes whole
// clips, not streams) gets one complete phrase at a time and never sees long silences, which is
// where it tends to invent text.

export const SAMPLE_RATE = 16000
const FRAME = 320 // 20 ms
const PREROLL_FRAMES = 15 // keep 300 ms before speech starts, so first syllables aren't clipped
const END_SILENCE_FRAMES = 35 // 700 ms of quiet ends an utterance
const KEEP_TAIL_FRAMES = 10 // keep 200 ms of that quiet
const MAX_FRAMES = 600 // cut long monologues every 12 s
const MIN_VOICED_FRAMES = 10 // ignore blips under 200 ms
const MIN_SPEECH_RMS = 0.01

export interface Segment {
  audio: Float32Array
  /** Sample offsets from the start of the stream. */
  startSample: number
  endSample: number
}

function concat(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(frames.length * FRAME)
  frames.forEach((f, i) => out.set(f, i * FRAME))
  return out
}

export class SpeechSegmenter {
  private frame = new Float32Array(FRAME)
  private frameFill = 0
  private framesSeen = 0
  private preroll: Float32Array[] = []
  private current: Float32Array[] | null = null
  private currentStart = 0
  private voicedFrames = 0
  private silentRun = 0
  private noise = 0.003
  /** Increments with every finished utterance, so stale interim results can be told apart. */
  generation = 0

  constructor(private readonly onSegment: (segment: Segment) => void) {}

  push(samples: Float32Array): void {
    let offset = 0
    while (offset < samples.length) {
      const take = Math.min(FRAME - this.frameFill, samples.length - offset)
      this.frame.set(samples.subarray(offset, offset + take), this.frameFill)
      this.frameFill += take
      offset += take
      if (this.frameFill === FRAME) {
        this.processFrame(this.frame)
        this.frame = new Float32Array(FRAME)
        this.frameFill = 0
      }
    }
  }

  /** The utterance in progress, for interim results; null when nobody is speaking. */
  partial(): Segment | null {
    if (!this.current || this.voicedFrames < MIN_VOICED_FRAMES) return null
    return {
      audio: concat(this.current),
      startSample: this.currentStart,
      endSample: this.currentStart + this.current.length * FRAME
    }
  }

  /** Ends the utterance in progress, e.g. when recording stops. */
  flush(): void {
    if (this.current) this.finish(true)
  }

  private processFrame(frame: Float32Array): void {
    let sum = 0
    for (let i = 0; i < FRAME; i++) sum += frame[i] * frame[i]
    const rms = Math.sqrt(sum / FRAME)
    const voiced = rms > Math.max(MIN_SPEECH_RMS, this.noise * 3.5)
    const frameStart = this.framesSeen * FRAME
    this.framesSeen++

    if (!this.current) {
      // Track the background level only between utterances.
      if (!voiced) this.noise = this.noise * 0.98 + rms * 0.02
      this.preroll.push(frame)
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift()
      if (voiced) {
        this.current = this.preroll
        this.currentStart = frameStart - (this.preroll.length - 1) * FRAME
        this.preroll = []
        this.voicedFrames = 1
        this.silentRun = 0
      }
      return
    }

    this.current.push(frame)
    if (voiced) {
      this.voicedFrames++
      this.silentRun = 0
    } else {
      this.silentRun++
    }
    if (this.silentRun >= END_SILENCE_FRAMES) this.finish(true)
    else if (this.current.length >= MAX_FRAMES) this.finish(false)
  }

  private finish(trimSilence: boolean): void {
    const frames = this.current ?? []
    const keep = trimSilence ? frames.length - Math.max(0, this.silentRun - KEEP_TAIL_FRAMES) : frames.length
    const voiced = this.voicedFrames
    this.current = null
    this.voicedFrames = 0
    this.silentRun = 0
    this.generation++
    if (voiced < MIN_VOICED_FRAMES || keep <= 0) return
    this.onSegment({
      audio: concat(frames.slice(0, keep)),
      startSample: this.currentStart,
      endSample: this.currentStart + keep * FRAME
    })
  }
}
