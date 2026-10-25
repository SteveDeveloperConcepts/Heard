import type { AudioSource } from '../../../shared/types'

export interface CaptureCallbacks {
  onChunk(source: AudioSource, pcm: ArrayBuffer): void
  onLevel(source: AudioSource, level: number): void
  /** A source stopped (device unplugged, permission revoked, or system audio unavailable). */
  onSourceEnded(source: AudioSource, reason: string): void
}

export interface CaptureOptions {
  micDeviceId: string | null
  systemAudio: boolean
}

/**
 * Captures the microphone and (optionally) system audio as two separate 16 kHz PCM streams, so the
 * transcript can tell "Me" apart from everyone else. Nothing here runs until `start()` is called,
 * and the main process refuses the underlying device requests unless a recording is armed.
 */
export class AudioCapture {
  private context: AudioContext | null = null
  private streams: MediaStream[] = []
  private stopped = false

  constructor(private readonly callbacks: CaptureCallbacks) {}

  /** Starts capture and returns the sources that are actually live. */
  async start(options: CaptureOptions): Promise<AudioSource[]> {
    const context = new AudioContext()
    this.context = context
    await context.audioWorklet.addModule(new URL('pcm-worklet.js', document.baseURI).href)

    const mic = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: options.micDeviceId ? { exact: options.micDeviceId } : undefined,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })
    this.attach('mic', mic)
    const live: AudioSource[] = ['mic']

    if (options.systemAudio) {
      try {
        this.attach('system', await this.openSystemAudio())
        live.push('system')
      } catch (err) {
        console.warn('System audio failed:', err)
        this.callbacks.onSourceEnded('system', describeSystemAudioError(err))
      }
    }
    return live
  }

  private async openSystemAudio(): Promise<MediaStream> {
    // Chromium only offers loopback audio through getDisplayMedia, which insists on video too.
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
    for (const track of stream.getVideoTracks()) {
      track.stop()
      stream.removeTrack(track)
    }
    if (stream.getAudioTracks().length === 0) {
      throw new Error('no-audio-track')
    }
    return stream
  }

  private attach(source: AudioSource, stream: MediaStream): void {
    const context = this.context
    if (!context) return
    this.streams.push(stream)

    const input = context.createMediaStreamSource(stream)
    const encoder = new AudioWorkletNode(context, 'pcm16-encoder', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers'
    })
    encoder.port.onmessage = (event: MessageEvent<{ type: 'pcm'; pcm: ArrayBuffer } | { type: 'level'; level: number }>) => {
      if (this.stopped) return
      if (event.data.type === 'pcm') this.callbacks.onChunk(source, event.data.pcm)
      else this.callbacks.onLevel(source, event.data.level)
    }
    // Route through a muted gain node so the graph is pulled without playing anything back.
    const mute = context.createGain()
    mute.gain.value = 0
    input.connect(encoder).connect(mute).connect(context.destination)

    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', () => {
        if (!this.stopped) this.callbacks.onSourceEnded(source, 'The audio device stopped.')
      })
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    for (const stream of this.streams) {
      for (const track of stream.getTracks()) track.stop()
    }
    this.streams = []
    const context = this.context
    this.context = null
    if (context && context.state !== 'closed') await context.close()
  }
}

function describeSystemAudioError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError') {
    return window.api.platform === 'darwin'
      ? 'System audio needs Screen & System Audio Recording permission (System Settings → Privacy & Security). Recording your microphone only.'
      : 'System audio capture was blocked. Recording your microphone only.'
  }
  if (err instanceof Error && err.message === 'no-audio-track') {
    return 'This system did not provide an audio track for system sound. Recording your microphone only.'
  }
  return `System audio unavailable (${err instanceof Error ? err.message : String(err)}). Recording your microphone only.`
}
