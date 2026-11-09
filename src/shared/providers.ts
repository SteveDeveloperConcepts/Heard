import type { AiProviderId, Settings } from './types'

export interface AiProviderInfo {
  label: string
  shortLabel: string
  blurb: string
  /** OpenAI-compatible endpoint. Anthropic (its own SDK) and Claude Code (a program) have none. */
  baseUrl?: string
  baseUrlEditable: boolean
  keyRequired: boolean
  envVar?: string
  keyUrl?: string
  defaultModel: string
  suggestedModels: string[]
  note?: string
}

export const AI_PROVIDER_IDS: readonly AiProviderId[] = ['anthropic', 'claude-code', 'openai', 'gemini', 'openrouter', 'ollama', 'custom']

export const AI_PROVIDERS: Record<AiProviderId, AiProviderInfo> = {
  anthropic: {
    label: 'Claude (Anthropic)',
    shortLabel: 'Claude',
    blurb: 'Anthropic',
    baseUrlEditable: false,
    keyRequired: true,
    envVar: 'ANTHROPIC_API_KEY',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-opus-5-5',
    suggestedModels: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']
  },
  'claude-code': {
    label: 'Claude Code (your Claude plan)',
    shortLabel: 'Claude Code',
    blurb: 'Your Claude plan, no key',
    baseUrlEditable: false,
    keyRequired: false,
    defaultModel: 'default',
    suggestedModels: ['default', 'opus', 'sonnet', 'haiku'],
    note:
      'Writes notes with Claude Code on this computer, signed in with your Claude subscription, so they count toward your plan\'s usage limits instead of being billed per use. Install Claude Code and run claude in a terminal once to sign in, then use Check below. The "default" model lets Claude Code choose.'
  },
  openai: {
    label: 'OpenAI',
    shortLabel: 'OpenAI',
    blurb: 'API key',
    baseUrl: 'https://api.openai.com/v1',
    baseUrlEditable: false,
    keyRequired: true,
    envVar: 'OPENAI_API_KEY',
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultModel: '',
    suggestedModels: []
  },
  gemini: {
    label: 'Google Gemini',
    shortLabel: 'Gemini',
    blurb: 'Google AI Studio key',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    baseUrlEditable: false,
    keyRequired: true,
    envVar: 'GEMINI_API_KEY',
    keyUrl: 'https://aistudio.google.com/apikey',
    defaultModel: '',
    suggestedModels: []
  },
  openrouter: {
    label: 'OpenRouter (many providers, one key)',
    shortLabel: 'OpenRouter',
    blurb: 'Many models, one key',
    baseUrl: 'https://openrouter.ai/api/v1',
    baseUrlEditable: false,
    keyRequired: true,
    envVar: 'OPENROUTER_API_KEY',
    keyUrl: 'https://openrouter.ai/keys',
    defaultModel: '',
    suggestedModels: []
  },
  ollama: {
    label: 'Ollama (runs on this computer)',
    shortLabel: 'Ollama',
    blurb: 'Private, on this computer',
    baseUrl: 'http://localhost:11434/v1',
    baseUrlEditable: true,
    keyRequired: false,
    defaultModel: '',
    suggestedModels: [],
    note: 'Notes and questions never leave your computer. Install Ollama and pull a model first.'
  },
  custom: {
    label: 'Other OpenAI-compatible API',
    shortLabel: 'Other',
    blurb: 'OpenAI-compatible URL',
    baseUrl: '',
    baseUrlEditable: true,
    keyRequired: false,
    defaultModel: '',
    suggestedModels: [],
    note: 'Any service with an OpenAI-style /chat/completions endpoint, such as LM Studio, Groq, Mistral, DeepSeek or a self-hosted vLLM server.'
  }
}

/** What still needs setting up before the AI can write notes, or null. Matches the main process's aiReady(). */
export function aiSetupProblem(s: Settings): string | null {
  const info = AI_PROVIDERS[s.aiProvider]
  if (info.keyRequired && s.aiKeys[s.aiProvider] === 'none') return `Add a ${info.label} API key to get summaries and notes.`
  if (!s.aiModels[s.aiProvider]) return `Choose a ${info.label} model to get summaries and notes.`
  if (usesBaseUrl(s.aiProvider) && !s.aiBaseUrls[s.aiProvider]) return `Set the ${info.label} API base URL to get summaries and notes.`
  return null
}

/** Whether the provider is reached at an OpenAI-compatible URL: everything but Claude and Claude Code. */
export function usesBaseUrl(id: AiProviderId): boolean {
  return AI_PROVIDERS[id].baseUrl !== undefined
}

/** How notes credit the model that wrote them. Claude Code's "default" is its own choice of model. */
export function modelLabel(provider: AiProviderId, model: string): string {
  if (provider !== 'claude-code') return model
  return model === 'default' ? 'Claude Code' : `Claude Code (${model})`
}

export function isAiProviderId(value: unknown): value is AiProviderId {
  return AI_PROVIDER_IDS.includes(value as AiProviderId)
}
