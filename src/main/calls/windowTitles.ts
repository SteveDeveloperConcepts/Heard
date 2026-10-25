import { desktopCapturer, systemPreferences } from 'electron'
import { appForWindowTitle, CALL_APPS, type CallApp } from './apps'

// Which web call a browser is in shows in its window title (the current tab's title), e.g.
// "Meet - abc-defg-hij - Google Chrome". Titles are only read while a browser is using the mic,
// only checked for a call, and never stored or sent anywhere.

// On Windows a normal browser window's title ends with the browser's name. Installed web apps
// (a Meet app, say) and macOS windows don't say which app they belong to.
const WINDOWS_BROWSER_TITLE = /\s[-–—]\s(Google Chrome|Microsoft​?\s?Edge|Mozilla Firefox|Brave|Opera|Vivaldi|Arc)\b/

/** macOS only shares other apps' window titles with apps allowed to record the screen. */
export function canReadWindowTitles(): boolean {
  return process.platform !== 'darwin' || systemPreferences.getMediaAccessStatus('screen') === 'granted'
}

/**
 * The web call showing in an open window, if any; the first in CALL_APPS order when several
 * match, so one browser on the mic never starts more than one call. Minimized windows aren't listed.
 */
export async function webCallOnScreen(): Promise<CallApp | undefined> {
  if (!canReadWindowTitles()) return undefined
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false
  })
  const found = new Set<CallApp>()
  for (const { name } of sources) {
    const inBrowser = process.platform === 'win32' && WINDOWS_BROWSER_TITLE.test(name)
    const app = appForWindowTitle(name, inBrowser)
    if (app) found.add(app)
  }
  return CALL_APPS.find((app) => found.has(app))
}
