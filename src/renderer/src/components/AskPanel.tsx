import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { markdownToPlainText, splitDraftEmail } from '../../../shared/email'
import type { ChatMessage } from '../../../shared/types'
import { markdownToEmailHtml } from '../lib/emailHtml'
import { cleanIpcError } from '../lib/format'
import { Icon } from './Icon'
import { Markdown } from './Markdown'

const SUGGESTIONS = ['What are my action items?', 'Summarize this in three bullets', 'Write a follow-up email to everyone']

interface Props {
  meetingId: string
  initialChat: ChatMessage[]
  /** Subject for an answer emailed as-is, when it doesn't start with its own "Subject:" line. */
  fallbackSubject: string
}

function AnswerActions({ text, fallbackSubject }: { text: string; fallbackSubject: string }) {
  const [status, setStatus] = useState<string | null>(null)

  async function openInGmail() {
    const { subject, body } = splitDraftEmail(text)
    try {
      const result = await window.api.share.openGmail({
        to: [],
        subject: subject ?? fallbackSubject,
        text: markdownToPlainText(body),
        html: markdownToEmailHtml(body)
      })
      setStatus(result.mode === 'prefilled' ? 'Opened in Gmail' : 'Opened in Gmail; paste the text from your clipboard')
    } catch (err) {
      setStatus(cleanIpcError(err))
    }
  }

  async function copy() {
    await window.api.share.copy({ text: markdownToPlainText(text), html: markdownToEmailHtml(text) })
    setStatus('Copied')
  }

  return (
    <div className="answer-actions">
      <button className="btn btn-primary small" onClick={() => void openInGmail()}>
        <Icon name="mail" size={14} /> Open in Gmail
      </button>
      <button className="btn small" onClick={() => void copy()}>
        Copy
      </button>
      {status && (
        <span className="hint" role="status">
          {status}
        </span>
      )}
    </div>
  )
}

export function AskPanel({ meetingId, initialChat, fallbackSubject }: Props) {
  const [messages, setMessages] = useState(initialChat)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<{ requestId: string | null; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(
    () =>
      window.api.ai.onEvent((event) => {
        if (event.meetingId !== meetingId || event.task !== 'ask') return
        if (event.type === 'delta') {
          setPending((p) => ({ requestId: event.requestId, text: (p?.text ?? '') + event.text }))
        } else if (event.type === 'done') {
          setPending(null)
          setMessages((m) => [...m, { id: event.requestId, role: 'assistant', text: event.text, createdAt: new Date().toISOString() }])
        } else if (event.type === 'error') {
          setPending(null)
          setError(event.message)
        }
      }),
    [meetingId]
  )

  useLayoutEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, pending, error])

  async function ask(question: string) {
    const text = question.trim()
    if (!text || pending) return
    setError(null)
    setDraft('')
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'user', text, createdAt: new Date().toISOString() }])
    setPending({ requestId: null, text: '' })
    try {
      const requestId = await window.api.ai.ask(meetingId, text)
      setPending((p) => (p ? { ...p, requestId } : p))
    } catch (err) {
      // Rejected before anything was saved (e.g. no API key): put the question back.
      setPending(null)
      setMessages((m) => m.slice(0, -1))
      setDraft(text)
      setError(cleanIpcError(err))
    }
  }

  return (
    <div className="ask">
      <div className="ask-messages" ref={listRef}>
        {messages.length === 0 && !pending && (
          <div className="ask-empty">
            <p className="muted">Ask anything about this meeting.</p>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => void ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) =>
          m.role === 'assistant' ? (
            <div key={m.id} className="msg msg-assistant">
              <Markdown text={m.text} />
              <AnswerActions text={m.text} fallbackSubject={fallbackSubject} />
            </div>
          ) : (
            <p key={m.id} className="msg msg-user">
              {m.text}
            </p>
          )
        )}
        {pending && (
          <div className="msg msg-assistant">
            {pending.text ? <Markdown text={pending.text} /> : <p className="muted">Thinking…</p>}
          </div>
        )}
        {error && (
          <div className="banner banner-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <form
        className="ask-input"
        onSubmit={(e) => {
          e.preventDefault()
          void ask(draft)
        }}
      >
        <label className="sr-only" htmlFor={`ask-${meetingId}`}>
          Ask about this meeting
        </label>
        <textarea
          id={`ask-${meetingId}`}
          value={draft}
          rows={2}
          placeholder="Ask about this meeting…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void ask(draft)
            }
          }}
        />
        {pending ? (
          <button
            type="button"
            className="icon-btn"
            aria-label="Stop"
            disabled={!pending.requestId}
            onClick={() => pending.requestId && window.api.ai.cancel(pending.requestId)}
          >
            <Icon name="stop" />
          </button>
        ) : (
          <button type="submit" className="icon-btn accent" aria-label="Send" disabled={!draft.trim()}>
            <Icon name="send" />
          </button>
        )}
      </form>
    </div>
  )
}
