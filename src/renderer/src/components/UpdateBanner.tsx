import type { UpdateState } from '../../../shared/types'

interface Props {
  update: UpdateState
  /** Restarting would end the recording, so it waits until the recording stops. */
  recording: boolean
  onLater(): void
  onInstall(): void
}

/** A newer Heard: ready to install on restart (Windows), or to download from its release page (Mac). */
export function UpdateBanner({ update, recording, onLater, onInstall }: Props) {
  const ready = update.kind === 'ready'
  return (
    <div className="update-banner" role="status">
      <span className="update-banner-text">
        <strong>
          Heard {update.version} is {ready ? 'ready to install' : 'available'}
        </strong>
        <span className="small muted">
          {ready
            ? recording
              ? 'Restart once you stop recording, or it installs the next time you quit Heard.'
              : 'It installs the next time you quit Heard. Restart now to start using it.'
            : 'Download it from the release page, then drag it to Applications to replace this copy.'}
        </span>
      </span>
      <button className="btn btn-ghost small" onClick={onLater}>
        Later
      </button>
      <button className="btn btn-primary small" onClick={onInstall} disabled={ready && recording}>
        {ready ? 'Restart now' : 'Download'}
      </button>
    </div>
  )
}
