// Messages between the main process and the speech-recognition utility process.

export type WorkerRequest =
  | { type: 'load'; model: string; cacheDir: string }
  | { type: 'transcribe'; id: number; audio: Float32Array; language: string | null }

export type WorkerResponse =
  /** Model download progress, 0–100. */
  | { type: 'progress'; progress: number }
  | { type: 'ready' }
  | { type: 'load-error'; message: string }
  | { type: 'result'; id: number; text: string }
  | { type: 'result'; id: number; error: string }
