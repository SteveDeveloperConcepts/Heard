import WebSocket from 'ws'
import type { LiveTranscriber, TranscriberCallbacks } from './types'

// Optional cloud engine: streams raw PCM to Deepgram's live transcription API and reports interim
// and final results. One instance per audio source.

export const SAMPLE_RATE = 16000
const KEEPALIVE_MS = 5000
const CLOSE_TIMEOUT_MS = 5000
const MAX_QUEUED_BYTES = SAMPLE_RATE * 2 * 15 // 15 s of audio while the socket connects

export interface DeepgramOptions extends TranscriberCallbacks {
  apiKey: string
  language: string
  diarize: boolean
}

interface DeepgramWord {
  speaker?: number
}

interface DeepgramResults {
  type: 'Results'
  start: number
  duration: number
  is_final: boolean
  channel: { alternatives: { transcript: string; words?: DeepgramWord[] }[] }
}

function majoritySpeaker(words: DeepgramWord[] | undefined): number | undefined {
  if (!words?.length) return undefined
  const counts = new Map<number, number>()
  for (const w of words) {
    if (w.speaker !== undefined) counts.set(w.speaker, (counts.get(w.speaker) ?? 0) + 1)
  }
  let best: number | undefined
  let bestCount = 0
  for (const [speaker, count] of counts) {
    if (count > bestCount) [best, bestCount] = [speaker, count]
  }
  return best
}

// ws reports a refused handshake as "Unexpected server response: <status>".
function describeFailure(err: Error): [message: string, retryable: boolean] {
  if (/\b401\b/.test(err.message)) return ['Deepgram rejected the API key. Check it in Settings.', false]
  if (/\b402\b/.test(err.message)) return ['Your Deepgram account is out of credit.', false]
  if (/\b403\b/.test(err.message)) return ['This Deepgram key is not allowed to use live transcription.', false]
  if (/\b429\b/.test(err.message)) return ['Deepgram is rate limiting this account.', true]
  return [`Transcription connection failed: ${err.message}`, true]
}

export class DeepgramLiveTranscriber implements LiveTranscriber {
  private readonly socket: WebSocket
  private queue: Buffer[] = []
  private queuedBytes = 0
  private lastSendAt = Date.now()
  private keepAlive: NodeJS.Timeout | null = null
  private finishing = false
  private failed = false

  constructor(private readonly options: DeepgramOptions) {
    const params = new URLSearchParams({
      model: 'nova-3',
      language: options.language,
      encoding: 'linear16',
      sample_rate: String(SAMPLE_RATE),
      channels: '1',
      interim_results: 'true',
      smart_format: 'true',
      punctuate: 'true',
      endpointing: '300',
      diarize: String(options.diarize)
    })
    this.socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
      headers: { Authorization: `Token ${options.apiKey}` }
    })
    this.socket.on('open', () => this.onOpen())
    this.socket.on('message', (data, isBinary) => {
      if (!isBinary) this.onMessage(data.toString())
    })
    this.socket.on('error', (err) => this.fail(...describeFailure(err)))
    this.socket.on('close', (code, reason) => {
      this.stopKeepAlive()
      if (!this.finishing) {
        this.fail(`Transcription connection closed (${code}${reason.length ? `: ${reason.toString()}` : ''}).`, true)
      }
    })
  }

  private onOpen(): void {
    for (const chunk of this.queue) this.socket.send(chunk)
    this.queue = []
    this.queuedBytes = 0
    // Deepgram closes a stream that gets no data for ~10 s; keep it open if audio stops arriving.
    this.keepAlive = setInterval(() => {
      if (Date.now() - this.lastSendAt >= KEEPALIVE_MS && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'KeepAlive' }))
      }
    }, KEEPALIVE_MS)
  }

  private onMessage(raw: string): void {
    let message: { type?: string }
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }
    if (message.type !== 'Results') return
    const result = message as DeepgramResults
    const alternative = result.channel.alternatives[0]
    const text = alternative?.transcript.trim()
    if (!text) return
    if (result.is_final) {
      this.options.onFinal({
        text,
        start: result.start,
        end: result.start + result.duration,
        speaker: this.options.diarize ? majoritySpeaker(alternative.words) : undefined
      })
    } else {
      this.options.onInterim(text)
    }
  }

  private fail(message: string, retryable: boolean): void {
    if (this.failed || this.finishing) return
    this.failed = true
    this.stopKeepAlive()
    this.socket.terminate()
    this.options.onFailure(message, retryable)
  }

  private stopKeepAlive(): void {
    if (this.keepAlive) clearInterval(this.keepAlive)
    this.keepAlive = null
  }

  send(pcm: Buffer): void {
    if (this.finishing || this.failed) return
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(pcm)
      this.lastSendAt = Date.now()
    } else if (this.socket.readyState === WebSocket.CONNECTING && this.queuedBytes < MAX_QUEUED_BYTES) {
      this.queue.push(pcm)
      this.queuedBytes += pcm.length
    }
  }

  /** Asks Deepgram to flush remaining results, then waits (briefly) for the socket to close. */
  finish(): Promise<void> {
    if (this.finishing) return Promise.resolve()
    this.finishing = true
    this.stopKeepAlive()
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.socket.terminate()
        resolve()
      }, CLOSE_TIMEOUT_MS)
      this.socket.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
      if (this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'CloseStream' }))
      } else {
        this.socket.terminate()
      }
    })
  }
}
