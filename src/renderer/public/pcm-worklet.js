// AudioWorklet that turns one audio input into 16 kHz mono 16-bit PCM in 100 ms chunks, the format
// the transcription service expects, and reports the input level ~40 times a second for the
// speaking animation. Plain JS because worklets are loaded as standalone modules.

const TARGET_RATE = 16000
const CHUNK_SAMPLES = TARGET_RATE / 10
const LEVELS_PER_SECOND = 40

class Pcm16Encoder extends AudioWorkletProcessor {
  constructor() {
    super()
    // `sampleRate` is the AudioContext's rate (usually 44.1 or 48 kHz), a global in worklet scope.
    this.step = sampleRate / TARGET_RATE
    this.pos = 0 // read position in the current block; -1 refers to the previous block's last sample
    this.last = 0
    this.out = new Int16Array(CHUNK_SAMPLES)
    this.outIndex = 0
    this.levelSum = 0
    this.levelCount = 0
  }

  emit(value) {
    const v = Math.max(-1, Math.min(1, value))
    this.out[this.outIndex++] = v < 0 ? v * 0x8000 : v * 0x7fff
    if (this.outIndex === CHUNK_SAMPLES) {
      this.port.postMessage({ type: 'pcm', pcm: this.out.buffer }, [this.out.buffer])
      this.out = new Int16Array(CHUNK_SAMPLES)
      this.outIndex = 0
    }
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0]
    if (!input || input.length === 0) return true
    const n = input.length

    // RMS level over ~25 ms of the original samples.
    for (let i = 0; i < n; i++) this.levelSum += input[i] * input[i]
    this.levelCount += n
    if (this.levelCount >= sampleRate / LEVELS_PER_SECOND) {
      this.port.postMessage({ type: 'level', level: Math.sqrt(this.levelSum / this.levelCount) })
      this.levelSum = 0
      this.levelCount = 0
    }

    // Linear-interpolation resampler that carries its position across 128-sample blocks.
    const at = (i) => (i < 0 ? this.last : input[i])
    let p = this.pos
    while (p < n - 1) {
      const i = Math.floor(p)
      const frac = p - i
      this.emit(at(i) + (at(i + 1) - at(i)) * frac)
      p += this.step
    }
    this.pos = p - n
    this.last = input[n - 1]
    return true
  }
}

registerProcessor('pcm16-encoder', Pcm16Encoder)
