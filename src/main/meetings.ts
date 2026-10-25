import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatMessage, Meeting, MeetingPatch, MeetingSummary, TranscriptSegment } from '../shared/types'

// Each meeting is one JSON file in <userData>/meetings. Everything is cached in memory after the
// first read and written back with a short debounce, since live transcription updates often.

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const WRITE_DELAY_MS = 750

const cache = new Map<string, Meeting>()
const pendingWrites = new Map<string, NodeJS.Timeout>()
let loaded: Promise<void> | null = null

export function meetingsDir(): string {
  return join(app.getPath('userData'), 'meetings')
}

function meetingFile(id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error(`Invalid meeting id: ${id}`)
  return join(meetingsDir(), `${id}.json`)
}

function loadAll(): Promise<void> {
  loaded ??= (async () => {
    await mkdir(meetingsDir(), { recursive: true })
    for (const name of await readdir(meetingsDir())) {
      if (!name.endsWith('.json')) continue
      try {
        const meeting = JSON.parse(await readFile(join(meetingsDir(), name), 'utf8')) as Meeting
        if (ID_PATTERN.test(meeting.id)) cache.set(meeting.id, meeting)
      } catch (err) {
        console.error(`Skipping unreadable meeting file ${name}:`, err)
      }
    }
  })()
  return loaded
}

async function writeNow(id: string): Promise<void> {
  pendingWrites.delete(id)
  const meeting = cache.get(id)
  if (!meeting) return
  const file = meetingFile(id)
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(meeting, null, 2), 'utf8')
  await rename(tmp, file)
}

function scheduleWrite(id: string): void {
  clearTimeout(pendingWrites.get(id))
  pendingWrites.set(
    id,
    setTimeout(() => {
      writeNow(id).catch((err) => console.error(`Failed to save meeting ${id}:`, err))
    }, WRITE_DELAY_MS)
  )
}

/** Writes any pending changes synchronously; called on quit. */
export function flushMeetings(): void {
  for (const [id, timer] of pendingWrites) {
    clearTimeout(timer)
    const meeting = cache.get(id)
    if (!meeting) continue
    const file = meetingFile(id)
    writeFileSync(`${file}.tmp`, JSON.stringify(meeting, null, 2), 'utf8')
    renameSync(`${file}.tmp`, file)
  }
  pendingWrites.clear()
}

function touch(meeting: Meeting): Meeting {
  meeting.updatedAt = new Date().toISOString()
  scheduleWrite(meeting.id)
  return meeting
}

async function mustGet(id: string): Promise<Meeting> {
  await loadAll()
  const meeting = cache.get(id)
  if (!meeting) throw new Error('Meeting not found')
  return meeting
}

function summarize(m: Meeting): MeetingSummary {
  const source = m.notes.trim() || m.enhancedNotes?.trim() || m.transcript[0]?.text || ''
  return {
    id: m.id,
    title: m.title,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    recordedMs: m.recordedMs,
    hasEnhancedNotes: Boolean(m.enhancedNotes),
    preview: source.replace(/[#*_>`-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)
  }
}

export async function listMeetings(): Promise<MeetingSummary[]> {
  await loadAll()
  return [...cache.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(summarize)
}

export async function getMeeting(id: string): Promise<Meeting | null> {
  meetingFile(id) // validates the id
  await loadAll()
  return cache.get(id) ?? null
}

export async function createMeeting(): Promise<Meeting> {
  await loadAll()
  const now = new Date().toISOString()
  const meeting: Meeting = {
    id: randomUUID(),
    title: '',
    createdAt: now,
    updatedAt: now,
    recordedMs: 0,
    notes: '',
    enhancedNotes: null,
    template: 'general',
    transcript: [],
    chat: []
  }
  cache.set(meeting.id, meeting)
  await writeNow(meeting.id)
  return meeting
}

export async function updateMeeting(id: string, patch: MeetingPatch): Promise<Meeting> {
  const meeting = await mustGet(id)
  if (patch.title !== undefined) meeting.title = String(patch.title).slice(0, 300)
  if (patch.notes !== undefined) meeting.notes = String(patch.notes)
  if (patch.enhancedNotes !== undefined) meeting.enhancedNotes = patch.enhancedNotes === null ? null : String(patch.enhancedNotes)
  if (patch.enhancedBy !== undefined) meeting.enhancedBy = patch.enhancedBy
  if (patch.template !== undefined) meeting.template = patch.template
  return touch(meeting)
}

export async function appendSegment(id: string, segment: TranscriptSegment): Promise<void> {
  touch(await mustGet(id)).transcript.push(segment)
}

export async function addRecordedTime(id: string, ms: number): Promise<void> {
  const meeting = await mustGet(id)
  meeting.recordedMs += Math.max(0, Math.round(ms))
  touch(meeting)
}

export async function appendChat(id: string, message: ChatMessage): Promise<void> {
  touch(await mustGet(id)).chat.push(message)
}

export async function deleteMeeting(id: string): Promise<void> {
  const file = meetingFile(id)
  await loadAll()
  clearTimeout(pendingWrites.get(id))
  pendingWrites.delete(id)
  cache.delete(id)
  await rm(file, { force: true })
}
