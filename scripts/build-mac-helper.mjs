// Builds the macOS call-detection helper (native/mac/call-monitor.swift) as a universal binary at
// build/mac/call-monitor, which electron-builder ships in the app's Resources folder.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') {
  console.log('Skipping: the call-detection helper can only be built on macOS.')
  process.exit(0)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'native', 'mac', 'call-monitor.swift')
const outDir = join(root, 'build', 'mac')
const output = join(outDir, 'call-monitor')
mkdirSync(outDir, { recursive: true })

const slices = ['arm64', 'x86_64'].map((arch) => {
  const slice = `${output}-${arch}`
  execFileSync('xcrun', ['swiftc', '-O', '-target', `${arch}-apple-macos13.0`, source, '-o', slice], { stdio: 'inherit' })
  return slice
})
execFileSync('xcrun', ['lipo', '-create', '-output', output, ...slices], { stdio: 'inherit' })
for (const slice of slices) rmSync(slice)
console.log(`Built ${output}`)
