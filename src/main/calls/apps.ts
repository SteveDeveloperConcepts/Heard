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
}

export const CALL_APPS: CallApp[] = [
  { id: 'whatsapp', name: 'WhatsApp', windows: /whatsapp/i, macBundleIds: ['net.whatsapp.WhatsApp', 'desktop.WhatsApp'] },
  { id: 'zoom', name: 'Zoom', windows: /(^|#)zoom\.exe$/i, macBundleIds: ['us.zoom'] },
  { id: 'teams', name: 'Microsoft Teams', windows: /^MSTeams_|(^|#)(ms-)?teams\.exe$/i, macBundleIds: ['com.microsoft.teams2', 'com.microsoft.teams'] },
  { id: 'slack', name: 'Slack', windows: /(^|#)slack\.exe$|\.Slack_/i, macBundleIds: ['com.tinyspeck.slackmacgap'] },
  { id: 'discord', name: 'Discord', windows: /(^|#)discord\.exe$/i, macBundleIds: ['com.hnc.Discord'] },
  { id: 'facetime', name: 'FaceTime', windows: null, macBundleIds: ['com.apple.FaceTime'] },
  { id: 'skype', name: 'Skype', windows: /skype/i, macBundleIds: ['com.skype.skype'] },
  { id: 'webex', name: 'Webex', windows: /(^|#)(webex|CiscoCollabHost)\.exe$/i, macBundleIds: ['Cisco-Systems.Spark'] }
]

export function appForWindowsEntry(entry: string): CallApp | undefined {
  return CALL_APPS.find((app) => app.windows?.test(entry))
}

export function appForBundleId(bundleId: string): CallApp | undefined {
  return CALL_APPS.find((app) => app.macBundleIds.some((id) => bundleId === id || bundleId.startsWith(`${id}.`)))
}
