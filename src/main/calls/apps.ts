export interface CallApp {
  id: string
  name: string
  /**
   * Matches the app's entry under Windows' microphone usage registry key: a Store package family
   * name (e.g. "5319275A.WhatsAppDesktop_cv1g1gvanyjgm") or, for desktop apps, the exe path with
   * "#" for "\" (e.g. "C:#Users#me#AppData#Roaming#Zoom#bin#Zoom.exe").
   */
  windows: RegExp | null
  /** macOS bundle ids; helper processes (e.g. "com.hnc.Discord.helper") match by prefix. */
  macBundleIds: string[]
  /** The title of a browser window (its current tab) during this service's web calls. */
  webTitle?: RegExp
  /** No desktop app's window has a title like webTitle, so it counts in any window. */
  webTitleIsUnique?: boolean
}

export const CALL_APPS: CallApp[] = [
  { id: 'whatsapp', name: 'WhatsApp', windows: /whatsapp/i, macBundleIds: ['net.whatsapp.WhatsApp', 'desktop.WhatsApp'] },
  { id: 'google-meet', name: 'Google Meet', windows: null, macBundleIds: [], webTitle: /^Meet\s[-–—]\s/, webTitleIsUnique: true },
  { id: 'zoom', name: 'Zoom', windows: /(^|#)zoom\.exe$/i, macBundleIds: ['us.zoom'], webTitle: /^Zoom\b|\bZoom Meeting\b/ },
  {
    id: 'teams',
    name: 'Microsoft Teams',
    windows: /^MSTeams_|(^|#)(ms-)?teams\.exe$/i,
    macBundleIds: ['com.microsoft.teams2', 'com.microsoft.teams'],
    webTitle: /\bMicrosoft Teams\b/
  },
  { id: 'slack', name: 'Slack', windows: /(^|#)slack\.exe$|\.Slack_/i, macBundleIds: ['com.tinyspeck.slackmacgap'] },
  { id: 'discord', name: 'Discord', windows: /(^|#)discord\.exe$/i, macBundleIds: ['com.hnc.Discord'] },
  { id: 'facetime', name: 'FaceTime', windows: null, macBundleIds: ['com.apple.FaceTime'] },
  { id: 'skype', name: 'Skype', windows: /skype/i, macBundleIds: ['com.skype.skype'] },
  { id: 'webex', name: 'Webex', windows: /(^|#)(webex|CiscoCollabHost)\.exe$/i, macBundleIds: ['Cisco-Systems.Spark'], webTitle: /\bWebex\b/ }
]

/**
 * Browsers. A browser on the mic may be in a call or doing something else entirely, so for these
 * the window titles decide which web call it is, if any (see CallApp.webTitle).
 */
const BROWSERS: Pick<CallApp, 'windows' | 'macBundleIds'>[] = [
  { windows: /(^|#)chrome\.exe$/i, macBundleIds: ['com.google.Chrome'] },
  { windows: /(^|#)msedge\.exe$/i, macBundleIds: ['com.microsoft.edgemac'] },
  { windows: /(^|#)firefox\.exe$/i, macBundleIds: ['org.mozilla.firefox', 'org.mozilla.plugincontainer'] },
  { windows: /(^|#)brave\.exe$/i, macBundleIds: ['com.brave.Browser'] },
  { windows: /(^|#)(opera|vivaldi)\.exe$/i, macBundleIds: ['com.operasoftware.Opera', 'com.vivaldi.Vivaldi'] },
  { windows: /^TheBrowserCompany\.Arc_/i, macBundleIds: ['company.thebrowser.Browser'] },
  // Safari captures audio in WebKit's GPU process.
  { windows: null, macBundleIds: ['com.apple.Safari', 'com.apple.WebKit.GPU'] }
]

function matchesBundleId(ids: string[], bundleId: string): boolean {
  return ids.some((id) => bundleId === id || bundleId.startsWith(`${id}.`))
}

export function appForWindowsEntry(entry: string): CallApp | undefined {
  return CALL_APPS.find((app) => app.windows?.test(entry))
}

export function appForBundleId(bundleId: string): CallApp | undefined {
  return CALL_APPS.find((app) => matchesBundleId(app.macBundleIds, bundleId))
}

export function isBrowserWindowsEntry(entry: string): boolean {
  return BROWSERS.some((browser) => browser.windows?.test(entry))
}

export function isBrowserBundleId(bundleId: string): boolean {
  return BROWSERS.some((browser) => matchesBundleId(browser.macBundleIds, bundleId))
}

/**
 * The web call a window's title shows, if any. `inBrowser` says the window is known to be a
 * browser's; otherwise only titles no desktop app uses count (a Teams or Zoom window looks the
 * same in the desktop app as in a browser).
 */
export function appForWindowTitle(title: string, inBrowser: boolean): CallApp | undefined {
  return CALL_APPS.find((app) => app.webTitle?.test(title) && (inBrowser || app.webTitleIsUnique))
}
