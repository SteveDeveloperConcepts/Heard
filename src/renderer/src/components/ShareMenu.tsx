import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from './Icon'

interface Props {
  disabled: boolean
  onEmail(): void
  onCopyFormatted(): void
  onCopyMarkdown(): void
}

function MenuItem({ icon, title, detail, onSelect }: { icon: IconName; title: string; detail: string; onSelect(): void }) {
  return (
    <button role="menuitem" className="menu-item" onClick={onSelect}>
      <Icon name={icon} size={18} />
      <span className="menu-item-text">
        <span className="menu-item-title">{title}</span>
        <span className="menu-item-detail">{detail}</span>
      </span>
    </button>
  )
}

export function ShareMenu({ disabled, onEmail, onCopyFormatted, onCopyMarkdown }: Props) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      if (!anchorRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = (action: () => void) => () => {
    setOpen(false)
    action()
  }

  return (
    <div className="menu-anchor" ref={anchorRef}>
      <button
        className={`btn${open ? ' btn-pressed' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        title={disabled ? 'Take some notes or record first' : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="share" /> Share
      </button>
      {open && (
        <div className="menu" role="menu" aria-label="Share notes">
          <MenuItem icon="mail" title="Email with Gmail…" detail="Opens a ready-to-send draft in your browser" onSelect={choose(onEmail)} />
          <MenuItem icon="copy" title="Copy for email" detail="Keeps headings and bullets when pasted" onSelect={choose(onCopyFormatted)} />
          <MenuItem icon="markdown" title="Copy as Markdown" detail="For docs, Slack and wikis" onSelect={choose(onCopyMarkdown)} />
        </div>
      )}
    </div>
  )
}
