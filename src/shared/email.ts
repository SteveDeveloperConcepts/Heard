import type { Meeting } from './types'
import { transcriptToText } from './transcript'

// Turns a meeting into an email: Markdown first (rendered to HTML for pasting), then plain text
// for Gmail compose links, which only carry unformatted bodies.

export interface EmailParts {
  enhanced: boolean
  notes: boolean
  transcript: boolean
}

export const EMAIL_PATTERN = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/

export function parseRecipients(input: string): string[] {
  return input
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function defaultSubject(meeting: Pick<Meeting, 'title' | 'createdAt'>): string {
  return `Notes: ${meeting.title.trim() || 'Untitled meeting'} (${shortDate(meeting.createdAt)})`
}

/** What a share includes when the user hasn't chosen: the AI notes if there are any, else theirs. */
export function defaultParts(meeting: Pick<Meeting, 'enhancedNotes' | 'notes'>): EmailParts {
  const enhanced = Boolean(meeting.enhancedNotes?.trim())
  return { enhanced, notes: !enhanced && Boolean(meeting.notes.trim()), transcript: false }
}

/** Task-list checkboxes become characters that survive both plain text and pasted HTML. */
function checkboxGlyphs(markdown: string): string {
  return markdown.replace(/^(\s*)[-*+] \[ \] /gm, '$1- ☐ ').replace(/^(\s*)[-*+] \[[xX]\] /gm, '$1- ☑ ')
}

export function buildEmailMarkdown(
  meeting: Pick<Meeting, 'title' | 'createdAt' | 'notes' | 'enhancedNotes' | 'transcript'>,
  parts: EmailParts,
  greeting: string
): string {
  const date = new Date(meeting.createdAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  const sections: string[] = []
  if (greeting.trim()) sections.push(greeting.trim())
  sections.push(`Here are the notes from ${meeting.title.trim() || 'our meeting'} (${date}).`)
  if (parts.enhanced && meeting.enhancedNotes?.trim()) sections.push(meeting.enhancedNotes.trim())
  if (parts.notes && meeting.notes.trim()) {
    // Trailing double spaces keep the user's line breaks as Markdown hard breaks.
    const lines = meeting.notes.trim().split('\n').map((line) => `${line}  `)
    sections.push(`## My notes\n\n${lines.join('\n')}`)
  }
  if (parts.transcript && meeting.transcript.length > 0) {
    sections.push(`## Transcript\n\n${transcriptToText(meeting.transcript).split('\n').join('\n\n')}`)
  }
  return checkboxGlyphs(sections.join('\n\n'))
}

function stripInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => (label === url ? url : `${label} (${url})`))
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,:;!?]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
}

/** Readable plain text for an email body: headings in caps, bullets as •, no Markdown syntax. */
export function markdownToPlainText(markdown: string): string {
  const out: string[] = []
  let inFence = false
  for (const raw of checkboxGlyphs(markdown).split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const text = stripInline(heading[2])
      out.push('', heading[1].length <= 2 ? text.toUpperCase() : text)
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('')
      continue
    }
    out.push(stripInline(line.replace(/^(\s*)[-*+] (?=[☐☑])/, '$1').replace(/^(\s*)[-*+] /, '$1• ').replace(/^>\s?/, '')))
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Splits an AI-drafted email into subject and body when it starts with a "Subject:" line. */
export function splitDraftEmail(markdown: string): { subject: string | null; body: string } {
  const lines = markdown.split('\n')
  const index = lines.findIndex((l) => l.trim() !== '')
  const match = index >= 0 ? /^\s*(?:\*\*|__)?subject:?(?:\*\*|__)?\s*:?\s*(.+)$/i.exec(lines[index]) : null
  if (!match) return { subject: null, body: markdown }
  const subject = stripInline(match[1]).replace(/^[*_]+|[*_]+$/g, '').trim()
  return { subject, body: lines.slice(index + 1).join('\n').trim() }
}
