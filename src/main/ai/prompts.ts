import type { Meeting, TemplateId } from '../../shared/types'
import { transcriptToText } from '../../shared/transcript'

export const ENHANCE_SYSTEM = `You write meeting notes. You get the notes the user typed during a meeting (often terse fragments) and a live transcript of it. Produce the notes the user would have written if they'd had time to capture everything that mattered.

About the inputs:
- In the transcript, "Me" is the user (their microphone). "Them" or "Speaker N" are the other participants (system audio). Use people's names when the conversation makes clear who is who.
- The transcript comes from live speech recognition, so expect misheard words. Correct obvious errors from context; never invent content to fill gaps.
- The user's notes show what they care about. Every point they wrote must appear in your notes, expanded with the relevant specifics from the transcript.

How to write:
- Follow the structure you are given, leaving out any section the meeting gave no material for.
- Short, concrete bullets: names, numbers, dates, commitments. No filler and no commentary about the meeting or the transcript itself.
- Only state what the notes or transcript support. If something important is ambiguous, say so briefly rather than guessing.
- Output GitHub-flavored Markdown, starting directly with the first heading. Don't add a title; the app already shows the meeting title.`

export const ASK_SYSTEM = `You help the user with one meeting they recorded. Its details, the user's own notes, and the transcript follow. In the transcript "Me" is the user and "Them" or "Speaker N" are the other participants; it comes from live speech recognition, so expect misheard words.

Answer from the meeting's content. Be direct and brief, and cite timestamps like [12:34] when pointing at a moment. If the meeting doesn't cover what's asked, say so plainly. When asked to draft something (a follow-up email, a recap for someone who missed it), write it ready to send. Use Markdown where it helps.`

const TEMPLATES: Record<TemplateId, string> = {
  general: `## Summary — two or three sentences: what the meeting was for and where it landed.
One ### section per major topic, with bullets.
## Decisions
## Action items — "- [ ] Owner: task (due date if one was mentioned)"
## Open questions`,
  'one-on-one': `## Check-in — how each person is doing, briefly.
## Topics — one ### section per topic, with bullets.
## Feedback — given or received, attributed.
## Growth & goals
## Action items — "- [ ] Owner: task (due date if one was mentioned)"`,
  'customer-call': `## Summary — who the customer is and what the call was about, in two or three sentences.
## Customer context — company, team, role, current setup and tools.
## Needs & pain points
## Questions & objections — with how each was answered.
## Commitments — what we promised, what they promised.
## Next steps — "- [ ] Owner: task (due date if one was mentioned)"`,
  standup: `One ### section per person who gave an update, each with:
- **Done:** …
- **Next:** …
- **Blockers:** … (omit if none)
## Blockers needing follow-up — "- [ ] Owner: what needs to happen"`,
  interview: `## Candidate — name, role interviewed for, background in two or three bullets.
## Topics covered — one ### section per question area, with the substance of the answers.
## Strengths — each tied to something specific they said.
## Concerns — each tied to something specific they said.
## Follow-ups — what to probe in later rounds.
Report evidence only; don't make a hire / no-hire recommendation.`
}

export function enhanceInstruction(template: TemplateId): string {
  return `Write the notes for this meeting using this structure:\n<structure>\n${TEMPLATES[template]}\n</structure>`
}

export function meetingContext(m: Meeting): string {
  const date = new Date(m.createdAt).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
  return [
    `<meeting>\nTitle: ${m.title.trim() || 'Untitled'}\nDate: ${date}\n</meeting>`,
    `<my_notes>\n${m.notes.trim() || '(No notes typed.)'}\n</my_notes>`,
    `<transcript>\n${transcriptToText(m.transcript) || '(No transcript.)'}\n</transcript>`
  ].join('\n\n')
}
