// Generates build/icon.png (1024×1024), which electron-builder converts to .ico and .icns.
// Drawn in code so the repo needs no image tooling: a note card with a waveform and a recording badge.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const SIZE = 1024
const SAMPLES = 4 // per axis, for anti-aliasing
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png')

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// Shapes take unit coordinates (0–1, y grows downward) and say whether a point is inside.
function roundRect(cx, cy, halfWidth, halfHeight, radius) {
  return (u, v) => {
    const dx = Math.max(Math.abs(u - cx) - (halfWidth - radius), 0)
    const dy = Math.max(Math.abs(v - cy) - (halfHeight - radius), 0)
    return Math.hypot(dx, dy) <= radius
  }
}

function circle(cx, cy, radius) {
  return (u, v) => Math.hypot(u - cx, v - cy) <= radius
}

function line(x0, x1, cy, thickness) {
  return roundRect((x0 + x1) / 2, cy, (x1 - x0) / 2, thickness / 2, thickness / 2)
}

function bar(cx, cy, width, height) {
  return roundRect(cx, cy, width / 2, height / 2, width / 2)
}

function color(hex) {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return () => rgb
}

// Ink tile, matching the app's dark recording bar, lighter toward the top left.
const INK_LIGHT = [52, 50, 46]
const INK_DARK = [21, 20, 18]
function ink(u, v) {
  const t = Math.min(1, Math.max(0, (u + v) / 2))
  return INK_LIGHT.map((c, i) => c + (INK_DARK[i] - c) * t)
}

// A meeting-notes card whose middle line is a live waveform, with a red "recording" badge.
const PAPER = color('#fbfaf7')
const TEXT_LINE = color('#d9d5cb')
const ACCENT = color('#3d5afe')
const RECORDING = color('#e5484d')
const WAVE = [0.05, 0.1, 0.07, 0.14, 0.09, 0.12, 0.06]
const LAYERS = [
  { shape: roundRect(0.5, 0.5, 0.42, 0.42, 0.2), fill: ink },
  { shape: roundRect(0.5, 0.53, 0.235, 0.285, 0.055), fill: PAPER },
  { shape: line(0.34, 0.6, 0.38, 0.035), fill: TEXT_LINE },
  ...WAVE.map((height, i) => ({ shape: bar(0.35 + i * 0.05, 0.515, 0.032, height), fill: ACCENT })),
  { shape: line(0.34, 0.66, 0.65, 0.035), fill: TEXT_LINE },
  { shape: line(0.34, 0.54, 0.71, 0.035), fill: TEXT_LINE },
  // The tile color around the badge separates it from the card's corner.
  { shape: circle(0.72, 0.29, 0.1), fill: ink },
  { shape: circle(0.72, 0.29, 0.072), fill: RECORDING }
]

const pixels = Buffer.alloc(SIZE * SIZE * 4)
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0
    let g = 0
    let b = 0
    let a = 0
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const u = (x + (sx + 0.5) / SAMPLES) / SIZE
        const v = (y + (sy + 0.5) / SAMPLES) / SIZE
        // The topmost layer containing the point decides its color.
        const top = LAYERS.findLast((layer) => layer.shape(u, v))
        if (!top) continue
        const [lr, lg, lb] = top.fill(u, v)
        r += lr
        g += lg
        b += lb
        a += 1
      }
    }
    const i = (y * SIZE + x) * 4
    if (a > 0) {
      pixels[i] = Math.round(r / a)
      pixels[i + 1] = Math.round(g / a)
      pixels[i + 2] = Math.round(b / a)
      pixels[i + 3] = Math.round((a / (SAMPLES * SAMPLES)) * 255)
    }
  }
}

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, encodePng(SIZE, pixels))
console.log(`Wrote ${out}`)
