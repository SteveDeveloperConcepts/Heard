import { Menu, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron'
import type { RecordingState, UpdateState } from '../shared/types'
import { recorder } from './recorder'
import { updater } from './updater'

// The tray icon is the always-visible answer to "is it listening?": a hollow ring when idle,
// a solid red dot while recording.

type Rgb = [number, number, number]

/** Draws an anti-aliased dot or ring as a raw BGRA bitmap. */
function drawCircle(size: number, color: Rgb, filled: boolean): Buffer {
  const buffer = Buffer.alloc(size * size * 4)
  const center = (size - 1) / 2
  const radius = size * 0.4
  const ringWidth = Math.max(1.5, size * 0.12)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - center, y - center)
      let coverage = Math.min(1, Math.max(0, radius - d + 0.5))
      if (!filled) coverage *= Math.min(1, Math.max(0, d - (radius - ringWidth) + 0.5))
      const i = (y * size + x) * 4
      buffer[i] = color[2]
      buffer[i + 1] = color[1]
      buffer[i + 2] = color[0]
      buffer[i + 3] = Math.round(coverage * 255)
    }
  }
  return buffer
}

function icon(recording: boolean): NativeImage {
  const mac = process.platform === 'darwin'
  const color: Rgb = recording ? [229, 57, 53] : mac ? [0, 0, 0] : [140, 140, 140]
  const size = mac ? 32 : 16
  const image = nativeImage.createFromBitmap(drawCircle(size, color, recording), {
    width: size,
    height: size,
    scaleFactor: mac ? 2 : 1
  })
  // Template images adapt to the light/dark macOS menu bar; the red dot must stay red.
  if (mac && !recording) image.setTemplateImage(true)
  return image
}

/** A newer version, for when Heard waits in the tray and its window (with the update banner) is closed. */
function updateItem(newer: UpdateState, recording: boolean): MenuItemConstructorOptions {
  return newer.kind === 'ready'
    ? // Restarting would end the recording.
      { label: `Restart to update to ${newer.version}`, enabled: !recording, click: () => void updater.install() }
    : { label: `Download Heard ${newer.version}…`, click: () => void updater.install() }
}

export function createTray(showWindow: () => void): Tray {
  const tray = new Tray(icon(false))

  const update = (state: RecordingState): void => {
    const newer = updater.state()
    tray.setImage(icon(state.active))
    tray.setToolTip(state.active ? 'Heard: recording' : 'Heard: not recording')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: state.active ? 'Recording…' : 'Not recording', enabled: false },
        ...(state.active ? [{ label: 'Stop recording', click: () => void recorder.stop() }] : []),
        { type: 'separator' },
        { label: 'Open Heard', click: showWindow },
        ...(newer ? [updateItem(newer, state.active)] : []),
        { label: 'Quit', role: 'quit' }
      ])
    )
  }

  recorder.on('state', update)
  updater.on('state', () => update(recorder.state()))
  update(recorder.state())
  if (process.platform !== 'darwin') tray.on('click', showWindow)
  return tray
}
