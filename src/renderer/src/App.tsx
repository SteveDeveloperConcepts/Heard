import { useCallback, useEffect, useState } from 'react'
import { aiSetupProblem } from '../../shared/providers'
import type { CallInfo, MeetingSummary, Settings, UpdateState } from '../../shared/types'
import { CallBanner } from './components/CallBanner'
import { Icon } from './components/Icon'
import { MeetingView } from './components/MeetingView'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'
import { UpdateBanner } from './components/UpdateBanner'
import { useRecording } from './hooks/useRecording'
import { cleanIpcError } from './lib/format'

function setupProblem(s: Settings): string | null {
  if (s.transcriptionEngine === 'deepgram' && s.deepgramKey === 'none') {
    return 'Add a Deepgram API key, or switch to built-in transcription in Settings.'
  }
  return aiSetupProblem(s)
}

function Welcome({ onNew }: { onNew(): void }) {
  return (
    <div className="welcome">
      <h1>Meeting notes that write themselves</h1>
      <ol>
        <li>Start a meeting and hit record. Heard listens to your mic and the call audio, only while recording.</li>
        <li>Jot quick notes as you go. The live transcript fills in on the right.</li>
        <li>Click Enhance notes and your AI turns your notes plus the transcript into clean meeting notes.</li>
      </ol>
      <button className="btn btn-primary" onClick={onNew}>
        <Icon name="plus" /> New meeting
      </button>
    </div>
  )
}

export function App() {
  const [meetings, setMeetings] = useState<MeetingSummary[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const recording = useRecording(settings)

  const refresh = useCallback(async () => {
    const list = await window.api.meetings.list()
    setMeetings(list)
    setLoaded(true)
    return list
  }, [])

  useEffect(() => {
    void refresh().then((list) => setSelectedId((id) => id ?? list[0]?.id ?? null))
    void window.api.settings.get().then(setSettings)
  }, [refresh])

  const newMeeting = useCallback(async () => {
    const meeting = await window.api.meetings.create()
    await refresh()
    setSelectedId(meeting.id)
  }, [refresh])

  const deleteMeeting = useCallback(
    async (id: string) => {
      if (!window.confirm('Delete this meeting, its notes and transcript? This can’t be undone.')) return
      await window.api.meetings.remove(id)
      const list = await refresh()
      setSelectedId(list[0]?.id ?? null)
    },
    [refresh]
  )

  // A rename from the sidebar; the open meeting's title field picks it up.
  const [renamed, setRenamed] = useState<{ id: string; title: string } | null>(null)
  const renameMeeting = useCallback(
    async (id: string, title: string) => {
      await window.api.meetings.update(id, { title })
      setRenamed({ id, title })
      await refresh()
    },
    [refresh]
  )

  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  const onMeetingChanged = useCallback(() => void refresh(), [refresh])

  // Notes and titles written after a recording stops show in the list, whichever meeting is open.
  useEffect(
    () =>
      window.api.ai.onEvent((event) => {
        if (event.type === 'done' && event.task !== 'ask') void refresh()
      }),
    [refresh]
  )

  // Detected calls only ever ask; recording starts when the user picks Record.
  const [callPrompt, setCallPrompt] = useState<CallInfo | null>(null)
  const { start: startRecording } = recording

  const recordCall = useCallback(
    async (call: CallInfo) => {
      setCallPrompt(null)
      const meeting = await window.api.meetings.create()
      // Also names the meeting after the call, until the AI gives it a better title.
      await window.api.calls.link(call.id, meeting.id, call.appName)
      await refresh()
      setSelectedId(meeting.id)
      await startRecording(meeting.id)
    },
    [refresh, startRecording]
  )

  useEffect(() => {
    void window.api.calls.current().then(setCallPrompt)
    return window.api.calls.onEvent((event) => {
      if (event.type === 'detected') setCallPrompt(event.call)
      else if (event.type === 'ended') setCallPrompt((c) => (c?.id === event.call.id ? null : c))
      else void recordCall(event.call)
    })
  }, [recordCall])

  // The update may have been found before this window loaded, so ask as well as listen.
  const [update, setUpdate] = useState<UpdateState | null>(null)
  /** The version put off with "Later". A newer one shows again. */
  const [updateLater, setUpdateLater] = useState<string | null>(null)
  useEffect(() => {
    void window.api.update.state().then((state) => setUpdate((current) => current ?? state))
    return window.api.update.onState(setUpdate)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === 'n') {
        e.preventDefault()
        void newMeeting()
      } else if (e.key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newMeeting])

  const problem = settings ? setupProblem(settings) : null

  return (
    <div className={`app platform-${window.api.platform}`}>
      <Sidebar
        meetings={meetings}
        selectedId={selectedId}
        recording={recording.state}
        onSelect={setSelectedId}
        onRename={(id, title) => void renameMeeting(id, title)}
        onNew={() => void newMeeting()}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className="main">
        {callPrompt && !recording.state.active && (
          <CallBanner call={callPrompt} onRecord={() => void recordCall(callPrompt)} onDismiss={() => setCallPrompt(null)} />
        )}
        {problem && (
          <div className="setup-banner">
            <span>{problem}</span>
            <button className="btn btn-ghost small" onClick={() => setSettingsOpen(true)}>
              Open settings
            </button>
          </div>
        )}
        {update && update.version !== updateLater && (
          <UpdateBanner
            update={update}
            recording={recording.state.active}
            onLater={() => setUpdateLater(update.version)}
            onInstall={() => void window.api.update.install().catch((err: unknown) => window.alert(cleanIpcError(err)))}
          />
        )}
        {selectedId ? (
          <MeetingView
            key={selectedId}
            meetingId={selectedId}
            settings={settings}
            recording={recording}
            renamed={renamed}
            onChanged={onMeetingChanged}
            onDelete={() => void deleteMeeting(selectedId)}
          />
        ) : (
          loaded && <Welcome onNew={() => void newMeeting()} />
        )}
      </main>
      {settingsOpen && settings && (
        <SettingsDialog settings={settings} engineStatus={recording.engine} onSaved={setSettings} onClose={closeSettings} />
      )}
    </div>
  )
}
