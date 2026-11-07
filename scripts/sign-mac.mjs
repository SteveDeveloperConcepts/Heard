// Signs the Mac app for electron-builder (`sign` in electron-builder.yml) the way it would itself,
// except for the call-detection helper (native/mac/call-monitor.swift). electron-builder gives every
// file in the app Electron's entitlements, build/entitlements.mac.plist. The helper needs none, so it
// gets build/entitlements.call-monitor.plist instead. Like everything else, it's still signed with
// the Developer ID (or ad-hoc, with electron-builder.adhoc.yml), the hardened runtime, and a secure
// timestamp, which notarisation requires of every program in the app.
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const helperEntitlements = join(root, 'build', 'entitlements.call-monitor.plist')

/** electron-builder's signing options, with the helper's own entitlements. */
export function withHelperEntitlements(options) {
  const helper = resolve(options.app, 'Contents', 'Resources', 'call-monitor')
  const forFile = options.optionsForFile
  return {
    ...options,
    optionsForFile(file) {
      const fileOptions = forFile ? forFile(file) : {}
      return resolve(file) === helper ? { ...fileOptions, entitlements: helperEntitlements } : fileOptions
    }
  }
}

/** The copy of @electron/osx-sign that electron-builder signs with when it signs by itself. */
export function osxSign() {
  const builder = dirname(require.resolve('electron-builder'))
  const builderLib = dirname(require.resolve('app-builder-lib', { paths: [builder] }))
  return require(require.resolve('@electron/osx-sign', { paths: [builderLib] }))
}

export default async function sign(options) {
  const { signAsync } = osxSign()
  const signOptions = withHelperEntitlements(options)
  // Apple's timestamp server sometimes turns a request away, so electron-builder tries again too.
  for (let attempt = 1; ; attempt++) {
    try {
      return await signAsync(signOptions)
    } catch (error) {
      if (attempt === 3) throw error
      console.warn(`Signing failed, trying again in ${attempt * 5} seconds: ${error.message}`)
      await new Promise((done) => setTimeout(done, attempt * 5000))
    }
  }
}
