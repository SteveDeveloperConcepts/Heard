import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { MeetingSummary, RecordingState } from '../../../shared/types'
import { formatDayLabel, formatDuration, formatTime } from '../lib/format'
import { Icon } from './Icon'

interface Props {
  meetings: MeetingSummary[]
  selectedId: string | null
  recording: RecordingState
  onSelect(id: string): void
  onRename(id: string, title: string): void
  onNew(): void
  onOpenSettings(): void
}

/** The right-click menu for a meeting in the list, shown where the click happened. */
function MeetingMenu({ x, y, onRename, onClose }: { x: number; y: number; onRename(): void; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.querySelector('button')?.focus()
    const onPointer = (e: globalThis.MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label="Meeting"
      style={{ left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 60) }}
    >
      <button role="menuitem" className="menu-item compact" onClick={onRename}>
        <Icon name="edit" size={16} /> Rename
      </button>
    </div>
  )
}

const WAVE = [5, 10, 7, 14, 9, 12, 6]

/** The app icon (scripts/make-icons.mjs) at sidebar size: a notes card with a waveform and a recording badge. */
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 100 100" aria-hidden="true">
      <rect className="brand-mark-tile" x="8" y="8" width="84" height="84" rx="20" />
      <rect x="26.5" y="24.5" width="47" height="57" rx="5.5" fill="#fbfaf7" />
      <rect x="34" y="36.25" width="26" height="3.5" rx="1.75" fill="#d9d5cb" />
      {WAVE.map((height, i) => (
        <rect key={i} x={33.4 + i * 5} y={51.5 - height / 2} width="3.2" height={height} rx="1.6" fill="#3d5afe" />
      ))}
      <rect x="34" y="63.25" width="32" height="3.5" rx="1.75" fill="#d9d5cb" />
      <rect x="34" y="69.25" width="20" height="3.5" rx="1.75" fill="#d9d5cb" />
      <circle className="brand-mark-tile" cx="72" cy="29" r="10" />
      <circle cx="72" cy="29" r="7.2" fill="#e5484d" />
    </svg>
  )
}

export function Sidebar({ meetings, selectedId, recording, onSelect, onRename, onNew, onOpenSettings }: Props) {
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  // The meeting being renamed and its title when the box opened. The box keeps showing that title,
  // so a title the AI gives meanwhile neither changes the text nor gets overwritten by it unchanged.
  const [renamingItem, setRenamingItem] = useState<{ id: string; from: string } | null>(null)
  // Enter, Escape and blur can all end the same rename; only the first one counts.
  const renaming = useRef<string | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  function openMenu(e: MouseEvent<HTMLButtonElement>, id: string) {
    e.preventDefault()
    // The keyboard's menu key reports no pointer position; open the menu by the item instead.
    const rect = e.currentTarget.getBoundingClientRect()
    const fromKeyboard = e.clientX === 0 && e.clientY === 0
    setMenu({ id, x: fromKeyboard ? rect.left + 24 : e.clientX, y: fromKeyboard ? rect.bottom : e.clientY })
  }

  function startRename(id: string) {
    setMenu(null)
    renaming.current = id
    setRenamingItem({ id, from: meetings.find((m) => m.id === id)?.title ?? '' })
  }

  function finishRename(id: string, value: string | null, from: string) {
    if (renaming.current !== id) return
    renaming.current = null
    setRenamingItem(null)
    const title = value?.trim()
    if (title && title !== from.trim()) onRename(id, title)
    // Put keyboard focus back on the meeting that was renamed.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-meeting-id="${id}"]`)?.focus())
  }

  function onRenameKey(e: KeyboardEvent<HTMLInputElement>, id: string, from: string) {
    if (e.key === 'Enter') finishRename(id, e.currentTarget.value, from)
    else if (e.key === 'Escape') finishRename(id, null, from)
  }

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const visible = q ? meetings.filter((m) => `${m.title} ${m.preview}`.toLowerCase().includes(q)) : meetings
    const result: { label: string; items: MeetingSummary[] }[] = []
    for (const meeting of visible) {
      const label = formatDayLabel(meeting.createdAt)
      const last = result[result.length - 1]
      if (last?.label === label) last.items.push(meeting)
      else result.push({ label, items: [meeting] })
    }
    return result
  }, [meetings, query])

  return (
    <aside className="sidebar">
      <div className="sidebar-header drag">
        <span className="brand">
          <BrandMark />
          Heard
        </span>
      </div>

      <div className="sidebar-actions">
        <label className="search">
          <Icon name="search" size={15} />
          <span className="sr-only">Search meetings</span>
          <input value={query} placeholder="Search meetings" onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button className="btn btn-primary btn-block btn-tall" onClick={onNew}>
          <Icon name="plus" /> New meeting
        </button>
      </div>

      <nav className="meeting-list" aria-label="Meetings">
        {groups.map((group) => (
          <section key={group.label}>
            <h3 className="list-heading">{group.label}</h3>
            {group.items.map((m) => {
              const live = recording.active && recording.meetingId === m.id
              const meta = (
                <span className="meeting-item-meta">
                  {formatTime(m.createdAt)}
                  {m.recordedMs > 0 && ` · ${formatDuration(m.recordedMs)}`}
                  {m.hasEnhancedNotes && ' · Notes ready'}
                </span>
              )
              if (m.id === renamingItem?.id) {
                const { from } = renamingItem
                return (
                  <div key={m.id} className="meeting-item renaming">
                    <input
                      className="rename-input"
                      defaultValue={from}
                      placeholder="Untitled meeting"
                      aria-label="Meeting name"
                      autoFocus
                      onFocus={(e) => e.currentTarget.select()}
                      onKeyDown={(e) => onRenameKey(e, m.id, from)}
                      onBlur={(e) => finishRename(m.id, e.currentTarget.value, from)}
                    />
                    {meta}
                  </div>
                )
              }
              return (
                <button
                  key={m.id}
                  data-meeting-id={m.id}
                  className={`meeting-item${m.id === selectedId ? ' selected' : ''}${menu?.id === m.id ? ' menu-open' : ''}`}
                  aria-current={m.id === selectedId ? 'page' : undefined}
                  onClick={() => onSelect(m.id)}
                  onContextMenu={(e) => openMenu(e, m.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'F2') startRename(m.id)
                  }}
                >
                  <span className="meeting-item-title">
                    <span className="truncate">{m.title || 'Untitled meeting'}</span>
                    {live && (
                      <span className="live-chip">
                        <span className="rec-dot small" /> Live
                      </span>
                    )}
                  </span>
                  {meta}
                </button>
              )
            })}
          </section>
        ))}
        {meetings.length === 0 && <p className="list-empty">No meetings yet.</p>}
        {meetings.length > 0 && groups.length === 0 && <p className="list-empty">No meetings match “{query}”.</p>}
      </nav>

      <div className="sidebar-footer">
        <button className="btn btn-ghost btn-block btn-left" onClick={onOpenSettings}>
          <Icon name="settings" /> Settings
        </button>
      </div>

      {menu && <MeetingMenu x={menu.x} y={menu.y} onRename={() => startRename(menu.id)} onClose={closeMenu} />}
    </aside>
  )
}
