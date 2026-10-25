// Runs Whisper speech recognition on this computer, in an Electron utility process so the heavy
// inference never blocks the app. Uses Transformers.js with ONNX Runtime on the CPU. The model is
// downloaded from Hugging Face the first time and cached in the app's data folder.
import { env, pipeline } from '@huggingface/transformers'
import { availableParallelism } from 'node:os'
import type { WorkerRequest, WorkerResponse } from './whisper-protocol'

const port = process.parentPort

function send(message: WorkerResponse): void {
  port.postMessage(message)
}

function loadModel(model: string, cacheDir: string) {
  env.cacheDir = cacheDir
  env.allowLocalModels = false
  return pipeline('automatic-speech-recognition', model, {
    device: 'cpu',
    // Full-precision encoder for accuracy, 8-bit decoder for speed and a smaller download.
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
    // Leave cores free so the call itself, and the rest of the computer, stay smooth.
    session_options: { intraOpNumThreads: Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2))) },
    // Overall progress across every model file (sizes are looked up before downloading starts).
    progress_callback: (info) => {
      if (info.status === 'progress_total') send({ type: 'progress', progress: info.progress })
    }
  })
}

let modelId = ''
let loading: ReturnType<typeof loadModel> | null = null

async function transcribe(request: Extract<WorkerRequest, { type: 'transcribe' }>): Promise<void> {
  try {
    if (!loading) throw new Error('The speech model is not loaded.')
    const asr = await loading
    // English-only models reject language and task options.
    const options = modelId.endsWith('.en')
      ? {}
      : { task: 'transcribe', ...(request.language ? { language: request.language } : {}) }
    const output = await asr(request.audio, options)
    const text = Array.isArray(output) ? output.map((o) => o.text).join(' ') : output.text
    send({ type: 'result', id: request.id, text: text.trim() })
  } catch (err) {
    send({ type: 'result', id: request.id, error: err instanceof Error ? err.message : String(err) })
  }
}

port.on('message', (event) => {
  const request = event.data as WorkerRequest
  if (request.type === 'load') {
    if (loading && request.model === modelId) return
    modelId = request.model
    const current = loadModel(request.model, request.cacheDir)
    loading = current
    current.then(
      () => send({ type: 'ready' }),
      (err: unknown) => {
        if (loading === current) loading = null
        send({ type: 'load-error', message: err instanceof Error ? err.message : String(err) })
      }
    )
  } else {
    void transcribe(request)
  }
})
