import { clipboard, ClipboardItem, shell } from 'electron'
import { EMAIL_PATTERN } from '../shared/email'
import type { GmailDraft, ShareResult } from '../shared/types'
import { loadSettings } from './settings'

// Gmail drafts open in the browser through Gmail's compose URL: nothing is sent until the user
// presses Send there, and no Google sign-in or API access is needed from this app.

// Google rejects very long URLs; past this the body goes to the clipboard instead.
const GMAIL_URL_LIMIT = 7500

function composeUrl(params: Record<string, string>): string {
  const query = Object.entries(params)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')
  return `https://mail.google.com/mail/?${query}`
}

export async function copyToClipboard(content: { text: string; html?: string }): Promise<void> {
  const item: Record<string, string> = { 'text/plain': content.text }
  if (content.html) item['text/html'] = content.html
  await clipboard.write([new ClipboardItem(item)])
}

export async function openGmailDraft(draft: GmailDraft): Promise<ShareResult> {
  const to = draft.to.map((a) => a.trim()).filter(Boolean)
  const invalid = to.find((address) => !EMAIL_PATTERN.test(address))
  if (invalid) throw new Error(`"${invalid}" doesn't look like an email address.`)

  const base = {
    authuser: loadSettings().gmailAccount.trim(),
    view: 'cm',
    fs: '1',
    to: to.join(','),
    su: draft.subject.trim().slice(0, 250)
  }
  let url = composeUrl({ ...base, body: draft.text })
  let mode: ShareResult['mode'] = 'prefilled'
  if (url.length > GMAIL_URL_LIMIT) {
    await copyToClipboard({ text: draft.text, html: draft.html })
    url = composeUrl(base)
    mode = 'clipboard'
  }
  await shell.openExternal(url)
  return { mode }
}
