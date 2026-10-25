import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { EMAIL_PATTERN } from '../shared/email'
import { AI_PROVIDERS, AI_PROVIDER_IDS } from '../shared/providers'
import type {
  AiProviderId,
  KeyStatus,
  LocalModelSize,
  MacAudioBackend,
  Settings,
  SettingsUpdate,
  TranscriptionEngine
} from '../shared/types'

type SecretName = 'deepgram' | AiProviderId

interface StoredSettings {
  /** API keys encrypted with the OS keychain (safeStorage), base64-encoded. */
  secrets: Partial<Record<SecretName, string>>
  transcriptionEngine: TranscriptionEngine
  localModel: LocalModelSize
  aiProvider: AiProviderId
  aiModels: Partial<Record<AiProviderId, string>>
  aiBaseUrls: Partial<Record<AiProviderId, string>>
  language: string
  captureSystemAudio: boolean
  micDeviceId: string | null
  macAudioBackend: MacAudioBackend
  gmailAccount: string
  emailGreeting: string
  callDetection: boolean
  stopWhenCallEnds: boolean
  liveTranscript: boolean
  keepInTray: boolean
  openAtLogin: boolean
}

export interface AiConfig {
  provider: AiProviderId
  model: string
  baseUrl: string
  apiKey: string | null
}

const DEFAULTS: StoredSettings = {
  secrets: {},
  transcriptionEngine: 'local',
  localModel: 'base',
  aiProvider: 'anthropic',
  aiModels: {},
  aiBaseUrls: {},
  language: 'en',
  captureSystemAudio: true,
  micDeviceId: null,
  macAudioBackend: 'screencapturekit',
  gmailAccount: '',
  emailGreeting: 'Hi all,',
  callDetection: true,
  stopWhenCallEnds: true,
  liveTranscript: false,
  keepInTray: true,
  openAtLogin: false
}

function envVar(name: SecretName): string | undefined {
  return name === 'deepgram' ? 'DEEPGRAM_API_KEY' : AI_PROVIDERS[name].envVar
}

let cache: StoredSettings | null = null

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/** Safe to call before the app is ready (the macOS audio backend is read at startup). */
export function loadSettings(): StoredSettings {
  if (cache) return cache
  try {
    const raw = JSON.parse(readFileSync(settingsFile(), 'utf8')) as Partial<StoredSettings>
    cache = {
      ...DEFAULTS,
      ...raw,
      secrets: { ...raw.secrets },
      aiModels: { ...raw.aiModels },
      aiBaseUrls: { ...raw.aiBaseUrls }
    }
  } catch {
    cache = { ...DEFAULTS, secrets: {}, aiModels: {}, aiBaseUrls: {} }
  }
  return cache
}

function save(settings: StoredSettings): void {
  const file = settingsFile()
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 })
  renameSync(tmp, file)
  cache = settings
}

export function getSecret(name: SecretName): string | null {
  const stored = loadSettings().secrets[name]
  if (stored) {
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'))
    } catch {
      // Keychain entry unreadable (e.g. settings copied from another machine): fall through.
    }
  }
  const env = envVar(name)
  return (env && process.env[env]?.trim()) || null
}

function keyStatus(name: SecretName): KeyStatus {
  if (loadSettings().secrets[name]) return 'stored'
  const env = envVar(name)
  return env && process.env[env] ? 'environment' : 'none'
}

function modelFor(s: StoredSettings, provider: AiProviderId): string {
  return s.aiModels[provider] ?? AI_PROVIDERS[provider].defaultModel
}

function baseUrlFor(s: StoredSettings, provider: AiProviderId): string {
  const info = AI_PROVIDERS[provider]
  return (info.baseUrlEditable ? s.aiBaseUrls[provider] : undefined) ?? info.baseUrl ?? ''
}

/** The AI provider configuration, optionally with unsaved values from the settings form. */
export function aiConfig(provider?: AiProviderId, draft: { baseUrl?: string; apiKey?: string } = {}): AiConfig {
  const s = loadSettings()
  const p = provider ?? s.aiProvider
  return {
    provider: p,
    model: modelFor(s, p),
    baseUrl: (AI_PROVIDERS[p].baseUrlEditable && draft.baseUrl?.trim()) || baseUrlFor(s, p),
    apiKey: draft.apiKey?.trim() || getSecret(p)
  }
}

export function publicSettings(): Settings {
  const s = loadSettings()
  const perProvider = <T>(fn: (p: AiProviderId) => T) =>
    Object.fromEntries(AI_PROVIDER_IDS.map((p) => [p, fn(p)])) as Record<AiProviderId, T>
  return {
    transcriptionEngine: s.transcriptionEngine,
    localModel: s.localModel,
    deepgramKey: keyStatus('deepgram'),
    aiProvider: s.aiProvider,
    aiKeys: perProvider(keyStatus),
    aiModels: perProvider((p) => modelFor(s, p)),
    aiBaseUrls: perProvider((p) => baseUrlFor(s, p)),
    language: s.language,
    captureSystemAudio: s.captureSystemAudio,
    micDeviceId: s.micDeviceId,
    macAudioBackend: s.macAudioBackend,
    gmailAccount: s.gmailAccount,
    emailGreeting: s.emailGreeting,
    callDetection: s.callDetection,
    stopWhenCallEnds: s.stopWhenCallEnds,
    liveTranscript: s.liveTranscript,
    keepInTray: s.keepInTray,
    openAtLogin: s.openAtLogin,
    // Only an installed app can register itself; a run from source would start bare Electron.
    openAtLoginAvailable: app.isPackaged
  }
}

function encrypt(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('This system has no keychain available to store API keys securely.')
  }
  return safeStorage.encryptString(value).toString('base64')
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  const url = new URL(trimmed) // throws on garbage
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('The API base URL must start with http:// or https://')
  return trimmed
}

function setSecret(next: StoredSettings, name: SecretName, value: string): void {
  const trimmed = value.trim()
  if (trimmed) next.secrets[name] = encrypt(trimmed)
  else delete next.secrets[name]
}

export function updateSettings(update: SettingsUpdate): Settings {
  const current = loadSettings()
  const next: StoredSettings = {
    ...current,
    secrets: { ...current.secrets },
    aiModels: { ...current.aiModels },
    aiBaseUrls: { ...current.aiBaseUrls }
  }

  if (update.transcriptionEngine !== undefined) next.transcriptionEngine = update.transcriptionEngine
  if (update.localModel !== undefined) next.localModel = update.localModel
  if (update.deepgramApiKey !== undefined) setSecret(next, 'deepgram', update.deepgramApiKey)
  if (update.aiProvider !== undefined) next.aiProvider = update.aiProvider
  for (const p of AI_PROVIDER_IDS) {
    const key = update.aiKeys?.[p]
    if (key !== undefined) setSecret(next, p, key)
    const model = update.aiModels?.[p]
    if (model !== undefined) next.aiModels[p] = model.trim()
    const baseUrl = update.aiBaseUrls?.[p]
    if (baseUrl !== undefined && AI_PROVIDERS[p].baseUrlEditable) next.aiBaseUrls[p] = normalizeBaseUrl(baseUrl)
  }

  if (update.language !== undefined) next.language = update.language
  if (update.captureSystemAudio !== undefined) next.captureSystemAudio = update.captureSystemAudio
  if (update.micDeviceId !== undefined) next.micDeviceId = update.micDeviceId
  if (update.macAudioBackend !== undefined) next.macAudioBackend = update.macAudioBackend
  if (update.gmailAccount !== undefined) {
    const account = update.gmailAccount.trim()
    if (account && !EMAIL_PATTERN.test(account)) throw new Error('The Gmail account must be an email address.')
    next.gmailAccount = account
  }
  if (update.emailGreeting !== undefined) next.emailGreeting = update.emailGreeting.trim().slice(0, 200)
  if (update.callDetection !== undefined) next.callDetection = update.callDetection
  if (update.stopWhenCallEnds !== undefined) next.stopWhenCallEnds = update.stopWhenCallEnds
  if (update.liveTranscript !== undefined) next.liveTranscript = update.liveTranscript
  if (update.keepInTray !== undefined) next.keepInTray = update.keepInTray
  if (update.openAtLogin !== undefined) next.openAtLogin = update.openAtLogin

  save(next)
  return publicSettings()
}
