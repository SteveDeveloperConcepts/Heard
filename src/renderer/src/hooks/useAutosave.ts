import { useCallback, useEffect, useRef } from 'react'
import type { MeetingPatch } from '../../../shared/types'

const DELAY_MS = 600

/** Batches edits to a meeting and saves them shortly after typing stops, and on unmount. */
export function useAutosave(meetingId: string, onSaved: () => void) {
  const pending = useRef<MeetingPatch>({})
  const timer = useRef<number | undefined>(undefined)
  const onSavedRef = useRef(onSaved)

  useEffect(() => {
    onSavedRef.current = onSaved
  }, [onSaved])

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current)
    const patch = pending.current
    pending.current = {}
    if (Object.keys(patch).length === 0) return
    try {
      await window.api.meetings.update(meetingId, patch)
      onSavedRef.current()
    } catch (err) {
      console.error('Autosave failed:', err)
    }
  }, [meetingId])

  const queue = useCallback(
    (patch: MeetingPatch) => {
      Object.assign(pending.current, patch)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void flush(), DELAY_MS)
    },
    [flush]
  )

  useEffect(() => () => void flush(), [flush])

  return { queue, flush }
}
