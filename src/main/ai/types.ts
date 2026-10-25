export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  /** Instructions for the task. */
  system: string
  /** The meeting itself: large, and identical across follow-up questions (cached where supported). */
  context: string
  messages: ChatTurn[]
  /** How hard to think, where the model supports it. */
  effort: 'low' | 'medium'
}

/** One backend that can write notes and answer questions. */
export interface AiClient {
  /** Streams text deltas to `onText` and resolves with the full response. Throws user-facing errors. */
  stream(request: ChatRequest, onText: (delta: string) => void, signal: AbortSignal): Promise<string>
  listModels(): Promise<string[]>
}
