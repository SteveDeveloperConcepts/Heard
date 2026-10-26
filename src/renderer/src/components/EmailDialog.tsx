import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import {
  EMAIL_PATTERN,
  buildEmailMarkdown,
  defaultParts,
  defaultSubject,
  markdownToPlainText,
  parseRecipients,
  type EmailParts
} from '../../../shared/email'
import type { Meeting, Settings } from '../../../shared/types'
import { cleanIpcError, formatLongDate } from '../lib/format'
import { markdownToEmailHtml } from '../lib/emailHtml'
import { Icon } from './Icon'

interface Props {
  meeting: Meeting
  settings: Settings
  onClose(): void
}

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; message: string } | { kind: 'error'; message: string }

// Remembered per meeting so a second send goes to the same people. Browser storage is fine here:
// it's a convenience, and the meeting works without it. The key keeps the app's old name so
// recipients saved before the rename are still found.
function recipientsKey(meetingId: string): string {
  return `stevenola:recipients:${meetingId}`
}

function loadRecipients(meetingId: string): string {
  try {
    return localStorage.getItem(recipientsKey(meetingId)) ?? ''
  } catch {
    return ''
  }
}

function saveRecipients(meetingId: string, value: string): void {
  try {
    localStorage.setItem(recipientsKey(meetingId), value)
  } catch {
    // Not critical.
  }
}

export function EmailDialog({ meeting, settings, onClose }: Props) {
  const [to, setTo] = useState(() => loadRecipients(meeting.id))
  const [subject, setSubject] = useState(() => defaultSubject(meeting))
  const [parts, setParts] = useState<EmailParts>(() => defaultParts(meeting))
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  const markdown = useMemo(() => buildEmailMarkdown(meeting, parts, settings.emailGreeting), [meeting, parts, settings.emailGreeting])
  const text = useMemo(() => markdownToPlainText(markdown), [markdown])
  const nothingSelected = !parts.enhanced && !parts.notes && !parts.transcript
  const hasEnhanced = Boolean(meeting.enhancedNotes?.trim())
  const hasNotes = Boolean(meeting.notes.trim())
  const hasTranscript = meeting.transcript.length > 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function openInGmail() {
    const recipients = parseRecipients(to)
    const invalid = recipients.find((r) => !EMAIL_PATTERN.test(r))
    if (invalid) {
      setStatus({ kind: 'error', message: `"${invalid}" doesn't look like an email address.` })
      return
    }
    setStatus({ kind: 'busy' })
    try {
      const result = await window.api.share.openGmail({ to: recipients, subject, text, html: markdownToEmailHtml(markdown) })
      saveRecipients(meeting.id, recipients.join(', '))
      setStatus({
        kind: 'done',
        message:
          result.mode === 'prefilled'
            ? 'Draft opened in Gmail. Review it there and press Send.'
            : 'These notes are too long for a Gmail link, so they’re on your clipboard with formatting. Paste them into the draft that just opened.'
      })
    } catch (err) {
      setStatus({ kind: 'error', message: cleanIpcError(err) })
    }
  }

  async function copyFormatted() {
    try {
      await window.api.share.copy({ text, html: markdownToEmailHtml(markdown) })
      setStatus({ kind: 'done', message: 'Copied with formatting. Paste into any email.' })
    } catch (err) {
      setStatus({ kind: 'error', message: cleanIpcError(err) })
    }
  }

  const toggle = (key: keyof EmailParts) => (e: ChangeEvent<HTMLInputElement>) =>
    setParts((p) => ({ ...p, [key]: e.target.checked }))

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal modal-email" role="dialog" aria-modal="true" aria-labelledby="email-title">
        <header className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <Icon name="mail" size={18} />
          </span>
          <div className="modal-heading">
            <h2 id="email-title">Email notes</h2>
            <span className="muted small">
              {meeting.title || 'Untitled meeting'} · {formatLongDate(meeting.createdAt)}
            </span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>

        <div className="modal-body stack">
          <div className="field">
            <label className="field-label" htmlFor="email-to">
              To
            </label>
            <input
              id="email-to"
              value={to}
              spellCheck={false}
              placeholder="name@example.com, another@example.com"
              onChange={(e) => setTo(e.target.value)}
            />
            <span className="hint">Separate addresses with commas. You can also add people in Gmail.</span>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="email-subject">
              Subject
            </label>
            <input id="email-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <fieldset className="include">
            <legend className="field-label">Include</legend>
            <label className="checkbox inline">
              <input type="checkbox" checked={parts.enhanced} disabled={!hasEnhanced} onChange={toggle('enhanced')} />
              <span>Enhanced notes</span>
            </label>
            <label className="checkbox inline">
              <input type="checkbox" checked={parts.notes} disabled={!hasNotes} onChange={toggle('notes')} />
              <span>My own notes</span>
            </label>
            <label className="checkbox inline">
              <input type="checkbox" checked={parts.transcript} disabled={!hasTranscript} onChange={toggle('transcript')} />
              <span>Full transcript</span>
            </label>
          </fieldset>
          <div className="field">
            <span className="field-label">Preview</span>
            <div className="email-preview">{nothingSelected ? 'Choose what to include.' : text}</div>
          </div>
          {status.kind === 'done' && (
            <div className="banner banner-success" role="status">
              <span>{status.message}</span>
            </div>
          )}
          {status.kind === 'error' && (
            <div className="banner banner-error" role="alert">
              <span>{status.message}</span>
            </div>
          )}
        </div>

        <footer className="modal-footer">
          <span className="hint grow">
            {settings.gmailAccount ? (
              <>
                Opens Gmail as <strong>{settings.gmailAccount}</strong>. Change the account in Settings.
              </>
            ) : (
              'Opens Gmail with your browser’s signed-in account. Choose another in Settings.'
            )}
          </span>
          <button className="btn" disabled={nothingSelected} onClick={() => void copyFormatted()}>
            Copy formatted
          </button>
          <button className="btn btn-primary" disabled={nothingSelected || status.kind === 'busy'} onClick={() => void openInGmail()}>
            Open in Gmail <Icon name="external" size={15} />
          </button>
        </footer>
      </div>
    </div>
  )
}
