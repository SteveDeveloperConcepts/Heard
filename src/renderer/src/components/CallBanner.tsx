import type { CallInfo } from '../../../shared/types'
import { Icon } from './Icon'

interface Props {
  call: CallInfo
  onRecord(): void
  onDismiss(): void
}

export function CallBanner({ call, onRecord, onDismiss }: Props) {
  return (
    <div className="call-banner" role="alert">
      <span className="call-banner-icon" aria-hidden="true">
        <Icon name="phone" size={16} />
      </span>
      <span className="call-banner-text">
        <strong>{call.appName} call in progress</strong>
        <span className="small muted">Record and transcribe it? Let everyone on the call know you’re recording.</span>
      </span>
      <button className="btn btn-ghost small" onClick={onDismiss}>
        Not now
      </button>
      <button className="btn btn-rec small" onClick={onRecord}>
        <Icon name="mic" size={14} /> Record call
      </button>
    </div>
  )
}
