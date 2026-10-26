import { app, utilityProcess, type UtilityProcess } from 'electron'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import type { LocalModelSize, TranscriberStatus } from '../../shared/types'
import { SAMPLE_RATE } from './segmenter'
import type { WorkerRequest, WorkerResponse } from './whisper-protocol'

// Seconds of speech waiting to be transcribed before the UI says the transcript is behind.
const BEHIND_SECONDS = 10

/** English gets the English-only model, which is more accurate at the same size. */
export function modelIdFor(size: LocalModelSize, language: string): string {
  return `onnx-community/whisper-${size}${language === 'en' ? '.en' : ''}`
}

function friendlyLoadError(message: string): string {
  if (/fetch|network|ENOTFOUND|ECONN|ETIMEDOUT|getaddrinfo/i.test(message)) {
    return 'Couldn’t download the speech model. Check your internet connection; it’s only needed the first time.'
  }
  return `The speech model failed to load: ${message}`
}

interface Job {
  id: number
  audio: Float32Array
  language: string | null
  resolve(text: string): void
  reject(err: Error): void
}

interface EngineEvents {
  status: [TranscriberStatus]
}

/** Owns the speech-recognition utility process and feeds it one clip at a time. */
class WhisperEngine extends EventEmitter<EngineEvents> {
  private worker: UtilityProcess | null = null
  private config: { size: LocalModelSize; language: string } | null = null
  private modelId = ''
  private status: TranscriberStatus = { state: 'idle' }
  private queue: Job[] = []
  private inFlight: Job | null = null
  private nextId = 1
  private shuttingDown = false

  currentStatus(): TranscriberStatus {
    return this.status
  }

  private setStatus(status: TranscriberStatus): void {
    this.status = status
    this.emit('status', status)
  }

  /** Starts the worker and loads the model, downloading it the first time. Returns immediately. */
  prepare(size: LocalModelSize, language: string): void {
    this.config = { size, language }
    const model = modelIdFor(size, language)
    const worker = this.ensureWorker()
    if (model === this.modelId && this.status.state !== 'error') return
    this.modelId = model
    this.setStatus({ state: 'loading' })
    const request: WorkerRequest = { type: 'load', model, cacheDir: join(app.getPath('userData'), 'models') }
    worker.postMessage(request)
  }

  /** True when nothing is waiting, so a low-priority interim result won't delay real ones. */
  isIdle(): boolean {
    return this.inFlight === null && this.queue.length === 0 && this.status.state === 'ready'
  }

  transcribe(audio: Float32Array, language: string | null): Promise<string> {
    if (this.status.state === 'error') return Promise.reject(new Error(this.status.message))
    if (!this.worker && this.config) this.prepare(this.config.size, this.config.language)
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, audio, language, resolve, reject })
      this.updateBacklog()
      this.pump()
    })
  }

  shutdown(): void {
    this.shuttingDown = true
    this.worker?.kill()
  }

  private ensureWorker(): UtilityProcess {
    if (this.worker) return this.worker
    const worker = utilityProcess.fork(join(__dirname, 'whisper-worker.js'), [], {
      serviceName: 'Heard speech recognition'
    })
    worker.on('message', (message: WorkerResponse) => this.onMessage(message))
    worker.on('exit', (code) => {
      this.worker = null
      this.modelId = ''
      const error = new Error(`Speech recognition stopped unexpectedly (exit code ${code}).`)
      this.inFlight?.reject(error)
      this.inFlight = null
      this.rejectQueued(error)
      if (!this.shuttingDown) this.setStatus({ state: 'error', message: error.message })
    })
    this.worker = worker
    return worker
  }

  private onMessage(message: WorkerResponse): void {
    switch (message.type) {
      case 'progress':
        if (this.status.state === 'loading' || this.status.state === 'downloading') {
          this.setStatus({ state: 'downloading', progress: message.progress, detail: this.modelId })
        }
        break
      case 'ready':
        this.setStatus({ state: 'ready' })
        this.updateBacklog()
        this.pump()
        break
      case 'load-error': {
        const text = friendlyLoadError(message.message)
        this.modelId = ''
        this.setStatus({ state: 'error', message: text })
        this.rejectQueued(new Error(text))
        break
      }
      case 'result': {
        const job = this.inFlight
        this.inFlight = null
        if (job && job.id === message.id) {
          if ('error' in message) job.reject(new Error(message.error))
          else job.resolve(message.text)
        }
        this.updateBacklog()
        this.pump()
        break
      }
    }
  }

  private pump(): void {
    if (this.inFlight || this.queue.length === 0 || !this.worker) return
    const job = this.queue.shift()!
    this.inFlight = job
    const request: WorkerRequest = { type: 'transcribe', id: job.id, audio: job.audio, language: job.language }
    this.worker.postMessage(request)
  }

  private rejectQueued(error: Error): void {
    const queued = this.queue
    this.queue = []
    for (const job of queued) job.reject(error)
  }

  private updateBacklog(): void {
    if (this.status.state !== 'ready' && this.status.state !== 'behind') return
    let samples = this.inFlight?.audio.length ?? 0
    for (const job of this.queue) samples += job.audio.length
    const seconds = Math.round(samples / SAMPLE_RATE)
    if (seconds > BEHIND_SECONDS) {
      if (this.status.state !== 'behind' || this.status.seconds !== seconds) this.setStatus({ state: 'behind', seconds })
    } else if (this.status.state === 'behind') {
      this.setStatus({ state: 'ready' })
    }
  }
}

export const whisperEngine = new WhisperEngine()
