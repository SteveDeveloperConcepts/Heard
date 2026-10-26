import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// The renderer never talks to the network itself: Deepgram and Anthropic are called from the main
// process, so the page only needs its own scripts, styles and the audio worklet.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'"
].join('; ')

// Added to production builds only: dev mode needs inline scripts for React Fast Refresh.
function contentSecurityPolicy(): Plugin {
  return {
    name: 'heard-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
          injectTo: 'head-prepend'
        }
      ]
    }
  }
}

export default defineConfig({
  main: {
    build: {
      rolldownOptions: {
        // The speech-recognition utility process is its own entry: out/main/whisper-worker.js.
        input: {
          index: resolve('src/main/index.ts'),
          'whisper-worker': resolve('src/main/transcription/whisper-worker.ts')
        }
      }
    }
  },
  preload: {},
  renderer: {
    plugins: [react(), contentSecurityPolicy()]
  }
})
