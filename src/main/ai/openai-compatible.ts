import { net } from 'electron'
import { AI_PROVIDERS } from '../../shared/providers'
import type { AiConfig } from '../settings'
import type { AiClient } from './types'

// Talks to any service implementing the OpenAI Chat Completions API: OpenAI itself, Gemini's
// compatibility endpoint, OpenRouter, Ollama, LM Studio, Groq and so on. The request uses only the
// fields every implementation accepts, so no token cap or reasoning options are sent.

function headers(config: AiConfig): Record<string, string> {
  const result: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) result.Authorization = `Bearer ${config.apiKey}`
  if (config.provider === 'openrouter') result['X-Title'] = 'SteveNola'
  return result
}

function errorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string }
    if (typeof parsed.error === 'string') return parsed.error
    return parsed.error?.message ?? parsed.message ?? body
  } catch {
    return body
  }
}

function describeHttpError(config: AiConfig, status: number, body: string): string {
  const label = AI_PROVIDERS[config.provider].label
  if (status === 401 || status === 403) return `${label} rejected the API key. Check it in Settings.`
  if (status === 404) return `${label} returned "not found". Check the model name ("${config.model}") and base URL in Settings.`
  if (status === 429) return `${label} is rate limiting this key. Try again in a moment.`
  return `${label} error (${status}): ${errorMessage(body).slice(0, 300)}`
}

async function request(config: AiConfig, path: string, init: RequestInit): Promise<Response> {
  if (!config.baseUrl) throw new Error('Set the API base URL for this provider in Settings.')
  let response: Response
  try {
    response = await net.fetch(`${config.baseUrl}${path}`, { ...init, headers: headers(config) })
  } catch (err) {
    if (init.signal?.aborted) throw err
    const hint = config.provider === 'ollama' ? ' Is Ollama running?' : ''
    throw new Error(`Could not reach ${config.baseUrl}.${hint}`)
  }
  if (!response.ok) throw new Error(describeHttpError(config, response.status, await response.text()))
  return response
}

interface ChunkPayload {
  error?: { message?: string }
  choices?: { delta?: { content?: string | null } }[]
}

export function openAiCompatibleClient(config: AiConfig): AiClient {
  return {
    async stream(req, onText, signal) {
      const response = await request(config, '/chat/completions', {
        method: 'POST',
        signal,
        body: JSON.stringify({
          model: config.model,
          stream: true,
          messages: [{ role: 'system', content: `${req.system}\n\n${req.context}` }, ...req.messages]
        })
      })
      if (!response.body) throw new Error('The provider sent an empty response.')

      // Server-sent events: one `data: {json}` line per chunk, ending with `data: [DONE]`.
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ''
      let text = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += value
        let newline: number
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') return text
          let chunk: ChunkPayload
          try {
            chunk = JSON.parse(data) as ChunkPayload
          } catch {
            continue
          }
          if (chunk.error) throw new Error(chunk.error.message ?? 'The provider reported an error mid-response.')
          const delta = chunk.choices?.[0]?.delta?.content
          if (delta) {
            text += delta
            onText(delta)
          }
        }
      }
      return text
    },

    async listModels() {
      const response = await request(config, '/models', { method: 'GET' })
      const body = (await response.json()) as { data?: { id: string }[] }
      // Gemini's compatibility endpoint lists ids as "models/<name>" but accepts the bare name.
      return (body.data ?? []).map((m) => m.id.replace(/^models\//, ''))
    }
  }
}
