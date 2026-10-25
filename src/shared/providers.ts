import type { AiProviderId } from './types'

export interface AiProviderInfo {
  label: string
  shortLabel: string
  blurb: string
  /** OpenAI-compatible endpoint. Anthropic has none: it is called through its own SDK. */
  baseUrl?: string
  baseUrlEditable: boolean
  keyRequired: boolean
  envVar?: string
  keyUrl?: string
  defaultModel: string
  suggestedModels: string[]
  note?: string
}

export const AI_PROVIDER_IDS: readonly AiProviderId[] = ['anthropic', 'openai', 'gemini', 'openrouter', 'ollama', 'custom']

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

export function isAiProviderId(value: unknown): value is AiProviderId {
  return AI_PROVIDER_IDS.includes(value as AiProviderId)
}
