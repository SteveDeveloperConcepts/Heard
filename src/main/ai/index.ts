import { randomUUID } from 'node:crypto'
import { AI_PROVIDERS } from '../../shared/providers'
import type { AiEvent, AiTask, ChatMessage, ModelListRequest } from '../../shared/types'
import { appendChat, getMeeting, updateMeeting } from '../meetings'
import { aiConfig, type AiConfig } from '../settings'
import { anthropicClient } from './anthropic'
import { openAiCompatibleClient } from './openai-compatible'
import { ASK_SYSTEM, ENHANCE_SYSTEM, enhanceInstruction, meetingContext } from './prompts'
import type { AiClient, ChatRequest } from './types'

type Emit = (event: AiEvent) => void

const running = new Map<string, AbortController>()

function clientFor(config: AiConfig): AiClient {
  return config.provider === 'anthropic' ? anthropicClient(config) : openAiCompatibleClient(config)
}

/** The configured provider, checked up front so setup problems surface before anything starts. */
function activeClient(): AiClient {
  const config = aiConfig()
  const info = AI_PROVIDERS[config.provider]
  if (!config.model) throw new Error(`Choose a ${info.label} model in Settings.`)
  // Anthropic can still authenticate through an `ant auth login` profile without a stored key.
  if (info.keyRequired && !config.apiKey && config.provider !== 'anthropic') {
    throw new Error(`Add your ${info.label} API key in Settings.`)
  }
  if (config.provider !== 'anthropic' && !config.baseUrl) throw new Error('Set the API base URL in Settings.')
  return clientFor(config)
}

interface RunOptions {
  task: AiTask
  meetingId: string
  request: ChatRequest
  onComplete(text: string): Promise<void>
}

/** Streams a response to the renderer and returns a request id that can be used to cancel it. */
function run(client: AiClient, options: RunOptions, emit: Emit): string {
  const requestId = randomUUID()
  const controller = new AbortController()
  running.set(requestId, controller)
  const { task, meetingId } = options

  void (async () => {
    try {
      const text = await client.stream(
        options.request,
        (delta) => emit({ requestId, meetingId, task, type: 'delta', text: delta }),
        controller.signal
      )
      if (!text.trim()) throw new Error('The model returned an empty response.')
      await options.onComplete(text)
      emit({ requestId, meetingId, task, type: 'done', text })
    } catch (err) {
      const message = controller.signal.aborted ? 'Stopped.' : err instanceof Error ? err.message : String(err)
      emit({ requestId, meetingId, task, type: 'error', message })
    } finally {
      running.delete(requestId)
    }
  })()

  return requestId
}

export async function enhanceNotes(meetingId: string, emit: Emit): Promise<string> {
  const meeting = await getMeeting(meetingId)
  if (!meeting) throw new Error('Meeting not found.')
  if (!meeting.notes.trim() && meeting.transcript.length === 0) {
    throw new Error('Nothing to work from yet. Record the meeting or type some notes first.')
  }
  const client = activeClient()
  const { model } = aiConfig()
  return run(
    client,
    {
      task: 'enhance',
      meetingId,
      request: {
        system: ENHANCE_SYSTEM,
        context: meetingContext(meeting),
        messages: [{ role: 'user', content: enhanceInstruction(meeting.template) }],
        effort: 'medium'
      },
      onComplete: async (text) => {
        await updateMeeting(meetingId, { enhancedNotes: text, enhancedBy: model })
      }
    },
    emit
  )
}

export async function askAboutMeeting(meetingId: string, question: string, emit: Emit): Promise<string> {
  const meeting = await getMeeting(meetingId)
  if (!meeting) throw new Error('Meeting not found.')
  const trimmed = question.trim()
  if (!trimmed) throw new Error('Type a question first.')
  const client = activeClient()

  const history = meeting.chat.map((m) => ({ role: m.role, content: m.text }))
  const asked: ChatMessage = { id: randomUUID(), role: 'user', text: trimmed, createdAt: new Date().toISOString() }
  await appendChat(meetingId, asked)

  return run(
    client,
    {
      task: 'ask',
      meetingId,
      request: {
        system: ASK_SYSTEM,
        context: meetingContext(meeting),
        messages: [...history, { role: 'user', content: trimmed }],
        effort: 'low'
      },
      onComplete: async (text) => {
        await appendChat(meetingId, { id: randomUUID(), role: 'assistant', text, createdAt: new Date().toISOString() })
      }
    },
    emit
  )
}

export function cancelAi(requestId: string): void {
  running.get(requestId)?.abort()
}

export async function listModels(request: ModelListRequest): Promise<string[]> {
  const config = aiConfig(request.provider, { baseUrl: request.baseUrl, apiKey: request.apiKey })
  const models = await clientFor(config).listModels()
  return [...new Set(models)].sort((a, b) => a.localeCompare(b))
}
