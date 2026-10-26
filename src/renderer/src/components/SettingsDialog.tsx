import { useEffect, useRef, useState } from 'react'
import { AI_PROVIDERS, AI_PROVIDER_IDS } from '../../../shared/providers'
import type {
  AiProviderId,
  KeyStatus,
  LocalModelSize,
  MacAudioBackend,
  MediaAccess,
  PermissionStatus,
  Settings,
  SettingsUpdate,
  TranscriberStatus,
  TranscriptionEngine
} from '../../../shared/types'
import { cleanIpcError } from '../lib/format'
import { Icon } from './Icon'

const LANGUAGES: [string, string][] = [
  ['en', 'English'],
  ['multi', 'Multilingual (auto-detect)'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['pt', 'Portuguese'],
  ['it', 'Italian'],
  ['nl', 'Dutch'],
  ['ja', 'Japanese'],
  ['hi', 'Hindi']
]

type Section = 'ai' | 'transcription' | 'audio' | 'calls' | 'sharing' | 'privacy'

const OTHER_MODEL = '__other__'

const SECTIONS: [Section, string][] = [
  ['ai', 'AI'],
  ['transcription', 'Transcription'],
  ['audio', 'Audio'],
  ['calls', 'Calls'],
  ['sharing', 'Sharing'],
  ['privacy', 'Privacy']
]

const ACCESS_LABEL: Record<MediaAccess, string> = {
  granted: 'Allowed',
  denied: 'Blocked',
  restricted: 'Restricted',
  'not-determined': 'Not asked yet',
  unknown: 'Unknown'
}

const MODEL_SIZES: { id: LocalModelSize; label: string; detail: string }[] = [
  { id: 'tiny', label: 'Fastest', detail: 'about 75 MB · good for older computers' },
  { id: 'base', label: 'Balanced', detail: 'about 130 MB · recommended' },
  { id: 'small', label: 'Most accurate', detail: 'about 500 MB · needs a fast computer' }
]

function engineStatusText(status: TranscriberStatus): string | null {
  switch (status.state) {
    case 'downloading':
      return `Downloading… ${Math.round(status.progress)}%`
    case 'loading':
      return 'Loading…'
    case 'ready':
    case 'behind':
      return 'Ready'
    case 'error':
      return status.message
    default:
      return null
  }
}

interface Props {
  settings: Settings
  engineStatus: TranscriberStatus
  onSaved(settings: Settings): void
  onClose(): void
}

interface KeyFieldProps {
  id: string
  label: string
  status: KeyStatus
  envVar?: string
  keyUrl?: string
  optional?: boolean
  value: string
  onChange(value: string): void
  /** Stores the key (encrypted) once it's pasted or the field is left. */
  onCommit(value: string): void
  onRemove(): void
}

const KEY_PROTECTION = window.api.platform === 'darwin' ? 'your macOS Keychain' : 'Windows data protection'
// API keys are long runs of letters, digits, '-', '_' and '.'; links and emails aren't.
const LOOKS_LIKE_KEY = /^[\w.-]{20,}$/

function KeyField({ id, label, status, envVar, keyUrl, optional, value, onChange, onCommit, onRemove }: KeyFieldProps) {
  const placeholder =
    status === 'stored'
      ? 'Saved and encrypted. Paste a new key to replace it.'
      : status === 'environment'
        ? `Using ${envVar} from the environment`
        : optional
          ? 'Optional'
          : 'Paste your API key'
  return (
    <div className="field">
      <div className="field-label">
        <label htmlFor={id}>{label}</label>
        {keyUrl && (
          <a href={keyUrl} target="_blank" rel="noreferrer">
            Get a key
          </a>
        )}
      </div>
      <div className="field-row">
        <input
          id={id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            const input = e.currentTarget
            // Store once the pasted text is in the field.
            requestAnimationFrame(() => onCommit(input.value))
          }}
          onBlur={(e) => {
            // Not when the whole window loses focus (switching apps halfway through typing).
            if (document.hasFocus()) onCommit(e.currentTarget.value)
          }}
        />
        {status === 'stored' && (
          <button type="button" className="btn btn-ghost small" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
      {status === 'stored' && <span className="hint">Encrypted on this computer with {KEY_PROTECTION}. Only sent to the provider.</span>}
    </div>
  )
}

function SectionHeading({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="section-heading">
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
    </div>
  )
}

export function SettingsDialog({ settings, engineStatus, onSaved, onClose }: Props) {
  const [section, setSection] = useState<Section>('ai')
  const [engine, setEngine] = useState<TranscriptionEngine>(settings.transcriptionEngine)
  const [localModel, setLocalModel] = useState<LocalModelSize>(settings.localModel)
  const [deepgramKey, setDeepgramKey] = useState('')
  const [provider, setProvider] = useState<AiProviderId>(settings.aiProvider)
  const [aiKeys, setAiKeys] = useState<Partial<Record<AiProviderId, string>>>({})
  const [aiModels, setAiModels] = useState(settings.aiModels)
  const [aiBaseUrls, setAiBaseUrls] = useState(settings.aiBaseUrls)
  const [autoSummary, setAutoSummary] = useState(settings.autoSummary)
  const [modelOptions, setModelOptions] = useState<Partial<Record<AiProviderId, string[]>>>({})
  // Providers where the user chose "Other model id…" to type an id that isn't in the list.
  const [typingModel, setTypingModel] = useState<Partial<Record<AiProviderId, boolean>>>({})
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [language, setLanguage] = useState(settings.language)
  const [captureSystemAudio, setCaptureSystemAudio] = useState(settings.captureSystemAudio)
  const [micDeviceId, setMicDeviceId] = useState(settings.micDeviceId)
  const [macAudioBackend, setMacAudioBackend] = useState<MacAudioBackend>(settings.macAudioBackend)
  const [gmailAccount, setGmailAccount] = useState(settings.gmailAccount)
  const [emailGreeting, setEmailGreeting] = useState(settings.emailGreeting)
  const [callDetection, setCallDetection] = useState(settings.callDetection)
  const [stopWhenCallEnds, setStopWhenCallEnds] = useState(settings.stopWhenCallEnds)
  const [liveTranscript, setLiveTranscript] = useState(settings.liveTranscript)
  const [keepInTray, setKeepInTray] = useState(settings.keepInTray)
  const [openAtLogin, setOpenAtLogin] = useState(settings.openAtLogin)
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const info = AI_PROVIDERS[provider]
  const isMac = window.api.platform === 'darwin'

  useEffect(() => {
    // Listing devices doesn't open any of them.
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) =>
        setMics(devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications'))
      )
      .catch(() => setMics([]))
    void window.api.permissions.status().then(setPermissions)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void saveRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function loadModels() {
    setLoadingModels(true)
    setModelError(null)
    try {
      const list = await window.api.ai.listModels({
        provider,
        baseUrl: aiBaseUrls[provider],
        apiKey: aiKeys[provider]?.trim() || undefined
      })
      setModelOptions((m) => ({ ...m, [provider]: list }))
      if (list.length === 0) setModelError('The provider returned no models.')
      else if (!aiModels[provider]) setAiModels((m) => ({ ...m, [provider]: list[0] }))
    } catch (err) {
      setModelError(cleanIpcError(err))
    } finally {
      setLoadingModels(false)
    }
  }

  async function removeKey(target: 'deepgram' | AiProviderId) {
    try {
      const update: SettingsUpdate = target === 'deepgram' ? { deepgramApiKey: '' } : { aiKeys: { [target]: '' } }
      onSaved(await window.api.settings.update(update))
    } catch (err) {
      setError(cleanIpcError(err))
    }
  }

  /**
   * Stores a key as soon as it's entered (the main process encrypts it), then drops the typed copy.
   * Text that doesn't look like a key (a pasted link, half a key) stays in the field until Done.
   */
  async function storeKey(target: 'deepgram' | AiProviderId, value: string) {
    const key = value.trim()
    if (!LOOKS_LIKE_KEY.test(key)) return
    try {
      const update: SettingsUpdate = target === 'deepgram' ? { deepgramApiKey: key } : { aiKeys: { [target]: key } }
      onSaved(await window.api.settings.update(update))
      if (target === 'deepgram') setDeepgramKey((v) => (v.trim() === key ? '' : v))
      else setAiKeys((k) => (k[target]?.trim() === key ? { ...k, [target]: '' } : k))
    } catch (err) {
      setError(cleanIpcError(err))
    }
  }

  // Closing Settings any way (✕, Escape, clicking outside, Done) keeps the changes.
  const savingRef = useRef(false)
  async function save() {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const typedKeys = Object.fromEntries(Object.entries(aiKeys).filter(([, v]) => v?.trim()))
      const update: SettingsUpdate = {
        transcriptionEngine: engine,
        localModel,
        aiProvider: provider,
        aiModels,
        aiBaseUrls,
        autoSummary,
        language,
        captureSystemAudio,
        micDeviceId,
        macAudioBackend,
        gmailAccount,
        emailGreeting,
        callDetection,
        stopWhenCallEnds,
        liveTranscript,
        keepInTray,
        openAtLogin,
        ...(deepgramKey.trim() ? { deepgramApiKey: deepgramKey } : {}),
        ...(Object.keys(typedKeys).length ? { aiKeys: typedKeys } : {})
      }
      onSaved(await window.api.settings.update(update))
      onClose()
    } catch (err) {
      setError(cleanIpcError(err))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save

  const models = [...new Set([...info.suggestedModels, ...(modelOptions[provider] ?? [])])]
  const model = aiModels[provider] ?? ''
  // A plain list, so every model shows: a datalist would hide the ones that don't match the current id.
  const typeModel = models.length === 0 || typingModel[provider] || (model !== '' && !models.includes(model))
  const modelIdInput = (
    <input
      id={models.length > 0 ? 'ai-model-id' : 'ai-model'}
      aria-label="Model id"
      value={model}
      spellCheck={false}
      placeholder="Type a model id, or load the list"
      onChange={(e) => setAiModels((m) => ({ ...m, [provider]: e.target.value }))}
    />
  )
  const restartNeeded = isMac && macAudioBackend !== settings.macAudioBackend

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) void save()
      }}
    >
      <div className="modal modal-settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="modal-header">
          <h2 id="settings-title" className="grow">
            Settings
          </h2>
          <button className="icon-btn" onClick={() => void save()} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>

        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings sections">
            {SECTIONS.map(([id, label]) => (
              <button key={id} className={section === id ? 'active' : ''} aria-current={section === id ? 'true' : undefined} onClick={() => setSection(id)}>
                {label}
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {section === 'ai' && (
              <section className="stack">
                <SectionHeading title="AI for notes and questions" detail="Pick who writes your notes. You can switch any time." />
                <fieldset className="provider-grid">
                  <legend className="sr-only">Provider</legend>
                  {AI_PROVIDER_IDS.map((id) => (
                    <label key={id} className={`provider-card${provider === id ? ' selected' : ''}`}>
                      <span className="provider-card-title">
                        <input
                          type="radio"
                          name="provider"
                          checked={provider === id}
                          onChange={() => {
                            setProvider(id)
                            setModelError(null)
                          }}
                        />
                        {AI_PROVIDERS[id].shortLabel}
                      </span>
                      <span className="provider-card-blurb">{AI_PROVIDERS[id].blurb}</span>
                    </label>
                  ))}
                </fieldset>
                {info.note && <p className="hint">{info.note}</p>}

                {info.baseUrlEditable && (
                  <div className="field">
                    <label className="field-label" htmlFor="ai-base-url">
                      API base URL
                    </label>
                    <input
                      id="ai-base-url"
                      value={aiBaseUrls[provider] ?? ''}
                      spellCheck={false}
                      placeholder="https://example.com/v1"
                      onChange={(e) => setAiBaseUrls((u) => ({ ...u, [provider]: e.target.value }))}
                    />
                    <span className="hint">The part before /chat/completions.</span>
                  </div>
                )}

                <div className="field-grid">
                  {(info.keyRequired || provider === 'custom') && (
                    <KeyField
                      id="ai-key"
                      label="API key"
                      status={settings.aiKeys[provider]}
                      envVar={info.envVar}
                      keyUrl={info.keyUrl}
                      optional={!info.keyRequired}
                      value={aiKeys[provider] ?? ''}
                      onChange={(v) => setAiKeys((k) => ({ ...k, [provider]: v }))}
                      onCommit={(v) => void storeKey(provider, v)}
                      onRemove={() => void removeKey(provider)}
                    />
                  )}
                  <div className="field">
                    <label className="field-label" htmlFor="ai-model">
                      Model
                    </label>
                    <div className="field-row">
                      {models.length === 0 ? (
                        modelIdInput
                      ) : (
                        <select
                          id="ai-model"
                          value={typeModel ? OTHER_MODEL : model}
                          onChange={(e) => {
                            const value = e.target.value
                            setTypingModel((t) => ({ ...t, [provider]: value === OTHER_MODEL }))
                            if (value !== OTHER_MODEL) setAiModels((m) => ({ ...m, [provider]: value }))
                          }}
                        >
                          {model === '' && !typeModel && (
                            <option value="" disabled>
                              Choose a model
                            </option>
                          )}
                          {models.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                          <option value={OTHER_MODEL}>Other model id…</option>
                        </select>
                      )}
                      <button type="button" className="btn small" disabled={loadingModels} onClick={() => void loadModels()}>
                        {loadingModels ? 'Loading…' : 'Load list'}
                      </button>
                    </div>
                    {models.length > 0 && typeModel && modelIdInput}
                    {modelError && <span className="hint error">{modelError}</span>}
                    {modelOptions[provider] && !modelError && (
                      <span className="hint">{modelOptions[provider]!.length} models available.</span>
                    )}
                  </div>
                </div>
                <label className="checkbox">
                  <input type="checkbox" checked={autoSummary} onChange={(e) => setAutoSummary(e.target.checked)} />
                  <span>
                    Write a summary and title when a recording stops
                    <span className="hint">
                      Your notes are ready by the time you look, opening with a summary. Meetings you've already named keep
                      their title, and notes you've edited by hand are never replaced.
                    </span>
                  </span>
                </label>
              </section>
            )}

            {section === 'transcription' && (
              <section className="stack">
                <SectionHeading title="Transcription" detail="How speech becomes text. Audio is never saved either way." />
                <fieldset className="provider-grid two">
                  <legend className="sr-only">Transcription engine</legend>
                  <label className={`provider-card${engine === 'local' ? ' selected' : ''}`}>
                    <span className="provider-card-title">
                      <input type="radio" name="engine" checked={engine === 'local'} onChange={() => setEngine('local')} />
                      Built-in
                    </span>
                    <span className="provider-card-blurb">Private and free: runs on this computer, no account</span>
                  </label>
                  <label className={`provider-card${engine === 'deepgram' ? ' selected' : ''}`}>
                    <span className="provider-card-title">
                      <input type="radio" name="engine" checked={engine === 'deepgram'} onChange={() => setEngine('deepgram')} />
                      Deepgram
                    </span>
                    <span className="provider-card-blurb">Cloud service: faster on slow computers, needs an API key</span>
                  </label>
                </fieldset>

                {engine === 'local' ? (
                  <div className="field">
                    <label className="field-label" htmlFor="local-model">
                      Speech model
                    </label>
                    <div className="field-row">
                      <select id="local-model" value={localModel} onChange={(e) => setLocalModel(e.target.value as LocalModelSize)}>
                        {MODEL_SIZES.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label} ({m.detail})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn small"
                        disabled={engineStatus.state === 'downloading' || engineStatus.state === 'loading'}
                        title="Save first to download a different size"
                        onClick={() => void window.api.recording.prepareTranscriber()}
                      >
                        Download now
                      </button>
                    </div>
                    <span className={`hint${engineStatus.state === 'error' ? ' error' : ''}`}>
                      {engineStatusText(engineStatus) ??
                        'Downloads once from Hugging Face on your first recording, then works offline.'}
                    </span>
                  </div>
                ) : (
                  <KeyField
                    id="deepgram-key"
                    label="Deepgram API key"
                    status={settings.deepgramKey}
                    envVar="DEEPGRAM_API_KEY"
                    keyUrl="https://console.deepgram.com/"
                    value={deepgramKey}
                    onChange={setDeepgramKey}
                    onCommit={(v) => void storeKey('deepgram', v)}
                    onRemove={() => void removeKey('deepgram')}
                  />
                )}
                <div className="field">
                  <label className="field-label" htmlFor="language">
                    Spoken language
                  </label>
                  <select id="language" value={language} onChange={(e) => setLanguage(e.target.value)}>
                    {LANGUAGES.map(([code, label]) => (
                      <option key={code} value={code}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="checkbox">
                  <input type="checkbox" checked={liveTranscript} onChange={(e) => setLiveTranscript(e.target.checked)} />
                  <span>
                    Show the transcript while recording
                    <span className="hint">
                      When off, Heard still transcribes as you go, but the transcript appears only when you stop recording.
                    </span>
                  </span>
                </label>
              </section>
            )}

            {section === 'audio' && (
              <section className="stack">
                <SectionHeading title="Audio" />
                <div className="field">
                  <label className="field-label" htmlFor="mic">
                    Microphone
                  </label>
                  <select id="mic" value={micDeviceId ?? ''} onChange={(e) => setMicDeviceId(e.target.value || null)}>
                    <option value="">System default</option>
                    {mics.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Microphone ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="checkbox">
                  <input type="checkbox" checked={captureSystemAudio} onChange={(e) => setCaptureSystemAudio(e.target.checked)} />
                  <span>
                    Capture other participants (system audio)
                    <span className="hint">Off records only your microphone. Headphones stop others being picked up twice.</span>
                  </span>
                </label>
                {isMac && (
                  <div className="field">
                    <label className="field-label" htmlFor="mac-backend">
                      macOS system audio method
                    </label>
                    <select id="mac-backend" value={macAudioBackend} onChange={(e) => setMacAudioBackend(e.target.value as MacAudioBackend)}>
                      <option value="screencapturekit">ScreenCaptureKit (default)</option>
                      <option value="coreaudio-tap">Core Audio tap (macOS 14.2+)</option>
                    </select>
                    {restartNeeded && <span className="hint">Takes effect after you restart Heard.</span>}
                  </div>
                )}
                {permissions && (
                  <div className="stack tight">
                    <div className="permission-row">
                      <span>Microphone</span>
                      <span className={`badge badge-${permissions.microphone}`}>{ACCESS_LABEL[permissions.microphone]}</span>
                      {permissions.microphone === 'not-determined' && isMac ? (
                        <button
                          className="btn small"
                          onClick={async () => {
                            await window.api.permissions.requestMicrophone()
                            setPermissions(await window.api.permissions.status())
                          }}
                        >
                          Allow
                        </button>
                      ) : (
                        permissions.microphone !== 'granted' && (
                          <button className="btn small" onClick={() => void window.api.permissions.openSystemSettings('microphone')}>
                            Open settings
                          </button>
                        )
                      )}
                    </div>
                    {isMac && (
                      <div className="permission-row">
                        <span>Screen &amp; System Audio Recording</span>
                        <span className={`badge badge-${permissions.screen}`}>{ACCESS_LABEL[permissions.screen]}</span>
                        {permissions.screen !== 'granted' && (
                          <button className="btn small" onClick={() => void window.api.permissions.openSystemSettings('screen')}>
                            Open settings
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {section === 'calls' && (
              <section className="stack">
                <SectionHeading
                  title="Calls"
                  detail="Heard can notice when WhatsApp, Zoom, Teams, Slack, Discord, FaceTime, Skype or Webex starts a call, or a Google Meet, Teams, Zoom or Webex call starts in your browser, and ask whether to record. It only checks which apps use the mic, and, while a browser does, the titles of open windows; it hears nothing until you say yes."
                />
                <label className="checkbox">
                  <input type="checkbox" checked={callDetection} onChange={(e) => setCallDetection(e.target.checked)} />
                  <span>
                    Ask to record when a call starts
                    <span className="hint">
                      You get a notification and a prompt in the app. Recording never starts by itself.
                      {isMac && ' Calls in a browser also need the Screen & System Audio Recording permission (see Audio).'}
                    </span>
                  </span>
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={stopWhenCallEnds}
                    disabled={!callDetection}
                    onChange={(e) => setStopWhenCallEnds(e.target.checked)}
                  />
                  <span>
                    Stop recording when the call ends
                    <span className="hint">Only for recordings started from a call prompt.</span>
                  </span>
                </label>
                <label className="checkbox">
                  <input type="checkbox" checked={keepInTray} onChange={(e) => setKeepInTray(e.target.checked)} />
                  <span>
                    Keep running when you close the window
                    <span className="hint">
                      Heard stays in the {isMac ? 'menu bar' : 'tray'} and keeps watching for calls. Quit from its{' '}
                      {isMac ? 'menu bar' : 'tray'} icon.
                    </span>
                  </span>
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={openAtLogin}
                    disabled={!settings.openAtLoginAvailable}
                    onChange={(e) => setOpenAtLogin(e.target.checked)}
                  />
                  <span>
                    Start Heard when you log in
                    <span className="hint">
                      {settings.openAtLoginAvailable
                        ? `It starts in the ${isMac ? 'menu bar' : 'tray'}, ready for your first call.`
                        : 'Available in the installed app, not when running from source.'}
                    </span>
                  </span>
                </label>
              </section>
            )}

            {section === 'sharing' && (
              <section className="stack">
                <SectionHeading title="Sharing" detail="Email opens a Gmail draft in your browser. Nothing is sent until you press Send there." />
                <div className="field-grid">
                  <div className="field">
                    <label className="field-label" htmlFor="gmail-account">
                      Gmail account
                    </label>
                    <input
                      id="gmail-account"
                      type="email"
                      value={gmailAccount}
                      spellCheck={false}
                      placeholder="Your browser’s default account"
                      onChange={(e) => setGmailAccount(e.target.value)}
                    />
                    <span className="hint">For when you’re signed in to several Google accounts.</span>
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="email-greeting">
                      Start emails with
                    </label>
                    <input id="email-greeting" value={emailGreeting} placeholder="Hi all," onChange={(e) => setEmailGreeting(e.target.value)} />
                  </div>
                </div>
              </section>
            )}

            {section === 'privacy' && (
              <section className="stack">
                <SectionHeading title="Privacy and data" />
                <p className="prose">
                  Heard opens your microphone and system audio only while a recording is running; the app refuses them at any other
                  time, and the tray icon turns red while it listens. Audio is never saved: built-in transcription processes it on
                  this computer (with Deepgram selected, it streams there instead). Transcripts and notes stay on this computer and
                  go to your AI provider only when you click Enhance or ask a question.
                  API keys are encrypted with your system keychain.
                </p>
                <div>
                  <button className="btn small" onClick={() => void window.api.openDataFolder()}>
                    Open data folder
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>

        <footer className="modal-footer">
          {error && (
            <span className="hint error grow" role="alert">
              {error}
            </span>
          )}
          <span className="spacer" />
          {error && (
            <button className="btn" onClick={onClose}>
              Close without saving
            </button>
          )}
          <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Done'}
          </button>
        </footer>
      </div>
    </div>
  )
}
