export interface FinalResult {
  text: string
  /** Seconds from the start of this stream. */
  start: number
  end: number
  speaker?: number
}

export interface TranscriberCallbacks {
  onFinal(result: FinalResult): void
  onInterim(text: string): void
  /** Transcription for this stream failed. Not called after finish(). */
  onFailure(message: string, retryable: boolean): void
}

/** One audio source's transcription stream: fed 16 kHz mono 16-bit PCM while recording. */
export interface LiveTranscriber {
  send(pcm: Buffer): void
  /** Transcribes any remaining audio, then resolves. */
  finish(): Promise<void>
}
