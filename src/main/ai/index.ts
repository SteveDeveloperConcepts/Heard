import { randomUUID } from 'node:crypto'
import { AI_PROVIDERS } from '../../shared/providers'
import type { AiEvent, AiProgress, AiTask, ChatMessage, Meeting, ModelListRequest } from '../../shared/types'
import { appendChat, getMeeting, pendingSummaries, setSummaryPending, updateMeeting } from '../meetings'
import { recorder } from '../recorder'
import { aiConfig, loadSettings, type AiConfig } from '../settings'
import { anthropicClient } from './anthropic'
import { openAiCompatibleClient } from './openai-compatible'
import { ASK_SYSTEM, ENHANCE_SYSTEM, TITLE_INSTRUCTION, cleanTitle, enhanceInstruction, meetingContext } from './prompts'
import type { AiClient, ChatRequest } from './types'

type Emit = (event: AiEvent) => void

// Less speech than this (about 20 words) is most likely a recording started by mistake.
const MIN_SPEECH_CHARS = 100
// Long enough for the window to save notes typed just before the recording stopped.
const NOTES_SETTLE_MS = 1000

const running = new Map<string, { meetingId: string; controller: AbortController }>()

interface EnhanceRun extends AiProgress {
  startedAt: number
  /** Called when this run, or a later one that replaced it, ends. */
  whenDone?(): void
}

/** Enhanced notes being written, by meeting. A newer run replaces an older one. */
const enhancing = new Map<string, EnhanceRun>()

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
  onText?(delta: string): void
  onComplete(text: string): Promise<void>
  onSettled?(): void
}

/** Streams a response to the renderer and returns a request id that can be used to cancel it. */
function run(client: AiClient, options: RunOptions, emit: Emit): string {
  const requestId = randomUUID()
  const controller = new AbortController()
  const { task, meetingId } = options
  running.set(requestId, { meetingId, controller })
  emit({ requestId, meetingId, task, type: 'start' })

  void (async () => {
    try {
      const text = await client.stream(
        options.request,
        (delta) => {
          options.onText?.(delta)
          emit({ requestId, meetingId, task, type: 'delta', text: delta })
        },
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
      options.onSettled?.()
    }
  })()

  return requestId
}

/** Title requests in flight, by meeting. A newer one replaces an older one. */
const titling = new Map<string, AbortController>()

/**
 * Whether the AI may name the meeting: it has no title of the user's own (none at all, or the one
 * from its call). The summary at the end of a recording may also replace a title the AI gave earlier.
 */
function needsTitle(meeting: Meeting, replaceAiTitle: boolean): boolean {
  return !meeting.title.trim() || meeting.titleSource === 'call' || (replaceAiTitle && meeting.titleSource === 'ai')
}

interface NotesConversation {
  context: string
  instruction: string
  notes: string
}

/** Names the meeting from its notes, unless the user has given it a title by the time the answer arrives. */
async function nameMeeting(
  meetingId: string,
  client: AiClient,
  conversation: NotesConversation,
  emit: Emit,
  { replaceAiTitle }: { replaceAiTitle: boolean }
): Promise<void> {
  const meeting = await getMeeting(meetingId)
  if (!meeting || !needsTitle(meeting, replaceAiTitle)) return
  titling.get(meetingId)?.abort()
  const requestId = randomUUID()
  const controller = new AbortController()
  titling.set(meetingId, controller)
  running.set(requestId, { meetingId, controller })
  try {
    const reply = await client.stream(
      {
        // The same instructions and meeting as the notes, so the provider's prompt cache is reused.
        system: ENHANCE_SYSTEM,
        context: conversation.context,
        messages: [
          { role: 'user', content: conversation.instruction },
          { role: 'assistant', content: conversation.notes },
          { role: 'user', content: TITLE_INSTRUCTION }
        ],
        effort: 'low'
      },
      () => {},
      controller.signal
    )
    const title = cleanTitle(reply)
    const latest = await getMeeting(meetingId)
    if (controller.signal.aborted || !title || !latest || !needsTitle(latest, replaceAiTitle)) return
    await updateMeeting(meetingId, { title, titleSource: 'ai' })
    emit({ requestId, meetingId, task: 'title', type: 'done', text: title })
  } catch (err) {
    // A missing title isn't worth an error banner; the notes are what matter.
    if (!controller.signal.aborted) console.warn('Could not name the meeting:', err instanceof Error ? err.message : err)
  } finally {
    running.delete(requestId)
    if (titling.get(meetingId) === controller) titling.delete(meetingId)
  }
}

interface EnhanceOptions {
  /** Started because a recording stopped, rather than by the user. */
  auto: boolean
  whenDone?(): void
}

/**
 * Writes the meeting's enhanced notes, replacing any still being written for it, then names it if it
 * has no title yet. `auto` runs keep notes the user edits while they're being written.
 */
function startEnhance(meeting: Meeting, client: AiClient, emit: Emit, { auto, whenDone }: EnhanceOptions): string {
  const meetingId = meeting.id
  const previous = enhancing.get(meetingId)
  if (previous) cancelAi(previous.requestId)
  titling.get(meetingId)?.abort() // these notes will name the meeting instead

  const { model } = aiConfig()
  const context = meetingContext(meeting)
  const instruction = enhanceInstruction(meeting.template)
  const segmentCount = meeting.transcript.length
  const notesBefore = meeting.enhancedNotes
  // A title from part of a meeting is replaced by the summary's when the recording stops.
  const name = (notes: string) => void nameMeeting(meetingId, client, { context, instruction, notes }, emit, { replaceAiTitle: auto })
  // The run this one replaces hands over what it was to do when it ended.
  const progress: EnhanceRun = { requestId: '', text: '', startedAt: Date.now(), whenDone: whenDone ?? previous?.whenDone }
  progress.requestId = run(
    client,
    {
      task: 'enhance',
      meetingId,
      request: { system: ENHANCE_SYSTEM, context, messages: [{ role: 'user', content: instruction }], effort: 'medium' },
      onText: (delta) => {
        progress.text += delta
      },
      onComplete: async (text) => {
        const latest = await getMeeting(meetingId)
        if (auto && latest?.enhancedEdited && latest.enhancedNotes !== notesBefore) {
          name(text)
          throw new Error('You edited the notes while the summary was being written, so your version was kept.')
        }
        await updateMeeting(meetingId, { enhancedNotes: text, enhancedBy: model, enhancedEdited: false, enhancedSegmentCount: segmentCount })
        name(text)
      },
      onSettled: () => {
        if (enhancing.get(meetingId) !== progress) return // replaced: the newer run finishes the job
        enhancing.delete(meetingId)
        progress.whenDone?.()
      }
    },
    emit
  )
  enhancing.set(meetingId, progress)
  return progress.requestId
}

export async function enhanceNotes(meetingId: string, emit: Emit): Promise<string> {
  const meeting = await getMeeting(meetingId)
  if (!meeting) throw new Error('Meeting not found.')
  if (!meeting.notes.trim() && meeting.transcript.length === 0) {
    throw new Error('Nothing to work from yet. Record the meeting or type some notes first.')
  }
  return startEnhance(meeting, activeClient(), emit, { auto: false })
}

/** Whether the AI can run without the user's help: the same checks as the window's setup banner. */
export function aiReady(): boolean {
  const config = aiConfig()
  const info = AI_PROVIDERS[config.provider]
  return Boolean(config.model && (!info.keyRequired || config.apiKey) && (config.provider === 'anthropic' || config.baseUrl))
}

function speechChars(text: string): number {
  return text.replace(/\s+/g, '').length
}

/**
 * After a recording ends: writes the notes, which open with a summary, and names the meeting.
 * Marked on disk until then, so a summary that quitting cuts short is written on the next start.
 */
export async function summarizeRecording(meetingId: string, emit: Emit, { resumed = false } = {}): Promise<void> {
  const finishedAt = Date.now()
  if (!resumed) setSummaryPending(meetingId, true)
  let handedOver = false
  try {
    handedOver = await startSummary(meetingId, finishedAt, emit)
  } finally {
    if (!handedOver) {
      // Notes still being written clear the mark when they end.
      const inFlight = enhancing.get(meetingId)
      if (inFlight) inFlight.whenDone ??= () => setSummaryPending(meetingId, false)
      else setSummaryPending(meetingId, false)
    }
  }
}

/** True once notes are being written that will clear the pending mark when they end. */
async function startSummary(meetingId: string, finishedAt: number, emit: Emit): Promise<boolean> {
  await new Promise((resolve) => setTimeout(resolve, NOTES_SETTLE_MS))
  const meeting = await getMeeting(meetingId)
  if (!meeting) return false
  // Recording again already: the summary waits until that recording stops too.
  if (recorder.state().meetingId === meetingId) return false
  const clearMark = () => setSummaryPending(meetingId, false)
  // Notes the user asked for after the transcript was complete already cover everything.
  const current = enhancing.get(meetingId)
  if (current && current.startedAt >= finishedAt) {
    current.whenDone ??= clearMark
    return true
  }
  if (!aiReady()) return false
  let client: AiClient
  try {
    client = activeClient()
  } catch {
    return false
  }
  // Notes started before the recording stopped are about to replace the stored ones, and would end
  // where they started: write notes on the whole meeting instead.
  if (current) {
    startEnhance(meeting, client, emit, { auto: true, whenDone: clearMark })
    return true
  }

  const notes = meeting.enhancedNotes?.trim() ? meeting.enhancedNotes : null
  const nameFromNotes = async (existing: string, replaceAiTitle: boolean) => {
    const conversation = { context: meetingContext(meeting), instruction: enhanceInstruction(meeting.template), notes: existing }
    await nameMeeting(meetingId, client, conversation, emit, { replaceAiTitle })
  }
  // Count only what was said since the notes were last written; the first time, typed notes too.
  const heard = meeting.transcript.slice(notes ? (meeting.enhancedSegmentCount ?? 0) : 0)
  const material = speechChars(heard.map((s) => s.text).join(' ')) + (notes ? 0 : speechChars(meeting.notes))
  if (material < MIN_SPEECH_CHARS) {
    // Little new to write about, but a meeting that has notes and no title still gets one.
    if (notes) await nameFromNotes(notes, false)
    return false
  }
  // Notes saved before edits were tracked count as the user's: they may have been changed by hand.
  const edited = meeting.enhancedEdited ?? meeting.enhancedSegmentCount === undefined
  if (notes && edited) {
    // Keep the user's notes, but still give the meeting a title that covers all of it.
    await nameFromNotes(notes, true)
    return false
  }
  // Notes started mid-recording are replaced too: these cover the whole transcript.
  startEnhance(meeting, client, emit, { auto: true, whenDone: clearMark })
  return true
}

/** Writes the summaries that quitting (or a crash) cut short. Called once at startup. */
export async function resumeSummaries(emit: Emit): Promise<void> {
  const enabled = loadSettings().autoSummary
  for (const meetingId of await pendingSummaries()) {
    if (enabled) void summarizeRecording(meetingId, emit, { resumed: true })
    else setSummaryPending(meetingId, false)
  }
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
  running.get(requestId)?.controller.abort()
}

/** Stops everything the AI is doing for a meeting, e.g. because it's being deleted. */
export function cancelMeetingAi(meetingId: string): void {
  for (const request of running.values()) {
    if (request.meetingId === meetingId) request.controller.abort()
  }
}

export function enhanceProgress(meetingId: string): AiProgress | null {
  const current = enhancing.get(meetingId)
  return current ? { requestId: current.requestId, text: current.text } : null
}

export async function listModels(request: ModelListRequest): Promise<string[]> {
  const config = aiConfig(request.provider, { baseUrl: request.baseUrl, apiKey: request.apiKey })
  const models = await clientFor(config).listModels()
  return [...new Set(models)].sort((a, b) => a.localeCompare(b))
}
