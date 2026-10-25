import { useEffect, useRef, useState } from 'react'
import { defaultSubject, markdownToPlainText } from '../../../shared/email'
import type { AudioSource, Meeting, Settings, TemplateId } from '../../../shared/types'
import { transcriptToText } from '../../../shared/transcript'
import { useAutosave } from '../hooks/useAutosave'
import type { RecordingController } from '../hooks/useRecording'
import { markdownToEmailHtml } from '../lib/emailHtml'
import { cleanIpcError, formatDuration, formatLongDate } from '../lib/format'
import { AskPanel } from './AskPanel'
import { EmailDialog } from './EmailDialog'
import { Icon } from './Icon'
import { Markdown } from './Markdown'
import { RecordingDock } from './RecordingDock'
import { ShareMenu } from './ShareMenu'
import { TranscriptPanel } from './TranscriptPanel'
import { VoiceChip } from './VoiceActivity'

const TEMPLATE_LABELS: Record<TemplateId, string> = {
  general: 'General meeting',
  'one-on-one': '1:1',
  'customer-call': 'Customer call',
  standup: 'Standup',
  interview: 'Interview'
}

interface Props {
  meetingId: string
  settings: Settings | null
  recording: RecordingController
  /** The latest rename from the sidebar, for any meeting. */
  renamed: { id: string; title: string } | null
  onChanged(): void
  onDelete(): void
}

export function MeetingView({ meetingId, settings, recording, renamed, onChanged, onDelete }: Props) {
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [tab, setTab] = useState<'notes' | 'enhanced'>('notes')
  const [side, setSide] = useState<'transcript' | 'ask'>('transcript')
  const [interim, setInterim] = useState<Partial<Record<AudioSource, string>>>({})
  const [enhancing, setEnhancing] = useState<{ requestId: string | null; text: string } | null>(null)
  const [editingEnhanced, setEditingEnhanced] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [emailOpen, setEmailOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const { queue, flush } = useAutosave(meetingId, onChanged)

  // Renaming this meeting in the sidebar updates the title here. Queuing it also replaces any
  // title edit that hasn't been saved yet, so the old title can't overwrite the new one.
  const seenRename = useRef(renamed)
  useEffect(() => {
    if (renamed === seenRename.current) return
    seenRename.current = renamed
    if (renamed?.id !== meetingId) return
    setTitle(renamed.title)
    queue({ title: renamed.title })
  }, [renamed, meetingId, queue])

  useEffect(() => {
    let cancelled = false
    void window.api.meetings.get(meetingId).then((m) => {
      if (cancelled || !m) return
      setMeeting(m)
      setTitle(m.title)
      setNotes(m.notes)
      setTab(m.enhancedNotes ? 'enhanced' : 'notes')
    })
    return () => {
      cancelled = true
    }
  }, [meetingId])

  useEffect(
    () =>
      window.api.recording.onTranscript((event) => {
        if (event.meetingId !== meetingId) return
        if (event.kind === 'final') {
          const { segment } = event
          setMeeting((m) => (m ? { ...m, transcript: [...m.transcript, segment] } : m))
          setInterim((i) => ({ ...i, [segment.source]: undefined }))
        } else if (event.kind === 'interim') {
          setInterim((i) => ({ ...i, [event.source]: event.text }))
        }
      }),
    [meetingId]
  )

  useEffect(
    () =>
      window.api.ai.onEvent((event) => {
        if (event.meetingId !== meetingId || event.task !== 'enhance') return
        if (event.type === 'delta') {
          setEnhancing((s) => ({ requestId: event.requestId, text: (s?.text ?? '') + event.text }))
        } else if (event.type === 'done') {
          setEnhancing(null)
          // The main process saved the notes and the model; reload to pick up both.
          void window.api.meetings.get(meetingId).then((fresh) => {
            if (fresh) setMeeting((m) => (m ? { ...m, enhancedNotes: fresh.enhancedNotes, enhancedBy: fresh.enhancedBy } : m))
          })
          onChanged()
        } else {
          setEnhancing(null)
          setAiError(event.message)
        }
      }),
    [meetingId, onChanged]
  )

  // When recording here stops, clear half-heard text and pick up the saved duration.
  const liveHere = recording.state.active && recording.state.meetingId === meetingId
  const wasLive = useRef(liveHere)
  useEffect(() => {
    if (wasLive.current && !liveHere) {
      setInterim({})
      void window.api.meetings.get(meetingId).then((fresh) => {
        if (fresh) setMeeting((m) => (m ? { ...m, recordedMs: fresh.recordedMs } : m))
      })
      onChanged()
    }
    wasLive.current = liveHere
  }, [liveHere, meetingId, onChanged])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function enhance() {
    setAiError(null)
    await flush() // the main process reads the saved notes
    setTab('enhanced')
    setEditingEnhanced(false)
    setEnhancing({ requestId: null, text: '' })
    try {
      const requestId = await window.api.ai.enhance(meetingId)
      setEnhancing((s) => (s ? { ...s, requestId } : s))
    } catch (err) {
      setEnhancing(null)
      setAiError(cleanIpcError(err))
    }
  }

  if (!meeting) return <div className="meeting" />

  // Sharing uses what's on screen, including edits the autosave hasn't flushed yet.
  const current: Meeting = { ...meeting, title, notes }
  const shareSource = meeting.enhancedNotes?.trim() || notes.trim()
  const enhancedText = enhancing ? enhancing.text : meeting.enhancedNotes

  async function copyFormatted() {
    const markdown = `**${title.trim() || 'Untitled meeting'}** · ${formatLongDate(meeting!.createdAt)}\n\n${shareSource}`
    await window.api.share.copy({ text: markdownToPlainText(markdown), html: markdownToEmailHtml(markdown) })
    setToast('Copied with formatting. Paste into any email.')
  }

  async function copyMarkdown() {
    await window.api.share.copy({ text: shareSource })
    setToast('Copied as Markdown.')
  }

  return (
    <div className="meeting">
      <section className="editor-column">
        <header className="meeting-header drag">
          <input
            className="title-input no-drag"
            value={title}
            placeholder="Untitled meeting"
            aria-label="Meeting title"
            onChange={(e) => {
              setTitle(e.target.value)
              queue({ title: e.target.value })
            }}
          />
          <div className="meeting-meta no-drag">
            <span className="muted small">
              {formatLongDate(meeting.createdAt)}
              {meeting.recordedMs > 0 && ` · ${formatDuration(meeting.recordedMs)}`}
            </span>
            <select
              className="select-inline"
              value={meeting.template}
              aria-label="Note structure"
              onChange={(e) => {
                const template = e.target.value as TemplateId
                setMeeting({ ...meeting, template })
                queue({ template })
              }}
            >
              {(Object.keys(TEMPLATE_LABELS) as TemplateId[]).map((id) => (
                <option key={id} value={id}>
                  {TEMPLATE_LABELS[id]}
                </option>
              ))}
            </select>
            <span className="spacer" />
            <ShareMenu
              disabled={!shareSource && meeting.transcript.length === 0}
              onEmail={() => setEmailOpen(true)}
              onCopyFormatted={() => void copyFormatted()}
              onCopyMarkdown={() => void copyMarkdown()}
            />
            <button
              className={meeting.enhancedNotes ? 'btn' : 'btn btn-primary'}
              onClick={() => void enhance()}
              disabled={enhancing !== null}
            >
              <Icon name="sparkle" /> {enhancing ? 'Writing…' : meeting.enhancedNotes ? 'Regenerate' : 'Enhance notes'}
            </button>
            <button className="icon-btn" title="Delete meeting" aria-label="Delete meeting" onClick={onDelete}>
              <Icon name="trash" />
            </button>
          </div>
        </header>

        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'notes'} className={`tab${tab === 'notes' ? ' active' : ''}`} onClick={() => setTab('notes')}>
            My notes
          </button>
          <button
            role="tab"
            aria-selected={tab === 'enhanced'}
            className={`tab${tab === 'enhanced' ? ' active' : ''}`}
            onClick={() => setTab('enhanced')}
          >
            Enhanced
          </button>
          <span className="spacer" />
          {tab === 'enhanced' && enhancing?.requestId && (
            <button className="btn btn-ghost small" onClick={() => window.api.ai.cancel(enhancing.requestId!)}>
              <Icon name="stop" size={14} /> Stop
            </button>
          )}
          {tab === 'enhanced' && !enhancing && meeting.enhancedNotes && (
            <>
              {meeting.enhancedBy && <span className="hint">Written with {meeting.enhancedBy}</span>}
              <button className="btn btn-ghost small" onClick={() => setEditingEnhanced((v) => !v)}>
                <Icon name={editingEnhanced ? 'check' : 'edit'} size={14} /> {editingEnhanced ? 'Done' : 'Edit'}
              </button>
            </>
          )}
        </div>

        {aiError && (
          <div className="banner banner-error inset" role="alert">
            <span>{aiError}</span>
            <button className="icon-btn" onClick={() => setAiError(null)} aria-label="Dismiss">
              <Icon name="close" size={14} />
            </button>
          </div>
        )}

        <div className="editor-body">
          {tab === 'notes' ? (
            <textarea
              className="notes-editor"
              value={notes}
              aria-label="My notes"
              placeholder="Type notes as you go. Short fragments are fine: Enhance turns them into full notes using the transcript."
              onChange={(e) => {
                setNotes(e.target.value)
                queue({ notes: e.target.value })
              }}
            />
          ) : editingEnhanced && meeting.enhancedNotes !== null ? (
            <textarea
              className="notes-editor mono-ish"
              value={meeting.enhancedNotes}
              aria-label="Enhanced notes (Markdown)"
              onChange={(e) => {
                const enhancedNotes = e.target.value
                setMeeting({ ...meeting, enhancedNotes })
                queue({ enhancedNotes })
              }}
            />
          ) : enhancedText ? (
            <article className="enhanced">
              <Markdown text={enhancedText} />
              {enhancing && <span className="writing-cursor" aria-hidden="true" />}
            </article>
          ) : enhancing ? (
            <p className="panel-empty">Writing your notes…</p>
          ) : (
            <div className="panel-empty">
              Enhanced notes combine what you typed with the transcript. Choose a structure above, then click{' '}
              <strong>Enhance notes</strong>.
            </div>
          )}
        </div>

        {toast && (
          <div className="toast" role="status">
            <Icon name="check" size={14} /> {toast}
          </div>
        )}
        <RecordingDock meetingId={meetingId} recordedMs={meeting.recordedMs} recording={recording} />
      </section>

      <aside className="side-column">
        <div className="tabs side-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={side === 'transcript'}
            className={`tab${side === 'transcript' ? ' active' : ''}`}
            onClick={() => setSide('transcript')}
          >
            Transcript
          </button>
          <button role="tab" aria-selected={side === 'ask'} className={`tab${side === 'ask' ? ' active' : ''}`} onClick={() => setSide('ask')}>
            Ask
          </button>
          <span className="spacer" />
          {liveHere ? (
            <span className="live-voices">
              <VoiceChip meter={recording.meter} source="mic" label="Me" tone="light" />
              {recording.state.sources.includes('system') && (
                <VoiceChip meter={recording.meter} source="system" label="Them" tone="light" />
              )}
            </span>
          ) : (
            side === 'transcript' &&
            meeting.transcript.length > 0 && (
              <button
                className="btn btn-ghost small"
                onClick={() => {
                  void window.api.share.copy({ text: transcriptToText(meeting.transcript) })
                  setToast('Transcript copied.')
                }}
              >
                <Icon name="copy" size={14} /> Copy
              </button>
            )
          )}
        </div>
        {/* Both panels stay mounted so scroll position and chat state survive tab switches. */}
        <div className="side-panel" hidden={side !== 'transcript'}>
          <TranscriptPanel
            segments={meeting.transcript}
            interim={interim}
            live={liveHere}
            hideWhileLive={!settings?.liveTranscript}
            meter={recording.meter}
            sources={recording.state.sources}
          />
        </div>
        <div className="side-panel" hidden={side !== 'ask'}>
          <AskPanel meetingId={meetingId} initialChat={meeting.chat} fallbackSubject={defaultSubject(current)} />
        </div>
      </aside>

      {emailOpen && settings && <EmailDialog meeting={current} settings={settings} onClose={() => setEmailOpen(false)} />}
    </div>
  )
}
