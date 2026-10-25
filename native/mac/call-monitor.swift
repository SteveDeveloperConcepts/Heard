// SteveNola call monitor: reports which apps are using audio input so the app can offer to record
// calls. It reads Core Audio metadata only; it never opens a device or touches audio.
//
// Prints one JSON line whenever the answer changes:
//   macOS 14.2+  {"inputApps":["net.whatsapp.WhatsApp"],"mode":"process"}
//   older        {"anyInput":true,"mode":"device","running":["net.whatsapp.WhatsApp", ...]}
//
// Built by scripts/build-mac-helper.mjs (needs Xcode 15.1+ command line tools).

import AppKit
import CoreAudio
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)

let systemObject = AudioObjectID(kAudioObjectSystemObject)

func propertyAddress(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(
    mSelector: selector,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
}

func readUInt32(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> UInt32? {
  var address = propertyAddress(selector)
  var value: UInt32 = 0
  var size = UInt32(MemoryLayout<UInt32>.size)
  return AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr ? value : nil
}

func readObjectList(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> [AudioObjectID] {
  var address = propertyAddress(selector)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(object, &address, 0, nil, &size) == noErr, size > 0 else { return [] }
  var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
  guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &ids) == noErr else { return [] }
  return ids
}

func readString(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
  var address = propertyAddress(selector)
  var value: Unmanaged<CFString>?
  var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
  let status = withUnsafeMutablePointer(to: &value) { pointer in
    AudioObjectGetPropertyData(object, &address, 0, nil, &size, pointer)
  }
  guard status == noErr, let string = value?.takeRetainedValue() else { return nil }
  return string as String
}

@available(macOS 14.2, *)
func appsUsingInput() -> [String] {
  var bundleIds = Set<String>()
  for process in readObjectList(systemObject, kAudioHardwarePropertyProcessObjectList) {
    guard readUInt32(process, kAudioProcessPropertyIsRunningInput) == 1 else { continue }
    if let bundleId = readString(process, kAudioProcessPropertyBundleID), !bundleId.isEmpty {
      bundleIds.insert(bundleId)
    }
  }
  return bundleIds.sorted()
}

func defaultInputInUse() -> Bool {
  var address = propertyAddress(kAudioHardwarePropertyDefaultInputDevice)
  var device = AudioObjectID(0)
  var size = UInt32(MemoryLayout<AudioObjectID>.size)
  guard AudioObjectGetPropertyData(systemObject, &address, 0, nil, &size, &device) == noErr, device != 0 else {
    return false
  }
  return readUInt32(device, kAudioDevicePropertyDeviceIsRunningSomewhere) == 1
}

func runningApps() -> [String] {
  Array(Set(NSWorkspace.shared.runningApplications.compactMap { $0.bundleIdentifier })).sorted()
}

func jsonLine(_ object: [String: Any]) -> String {
  guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
    let line = String(data: data, encoding: .utf8)
  else { return "{}" }
  return line
}

var lastLine = ""
while true {
  // Exit if SteveNola went away without stopping us.
  if getppid() == 1 { exit(0) }

  let line: String
  if #available(macOS 14.2, *) {
    line = jsonLine(["mode": "process", "inputApps": appsUsingInput()])
  } else {
    line = jsonLine(["mode": "device", "anyInput": defaultInputInUse(), "running": runningApps()])
  }
  if line != lastLine {
    print(line)
    lastLine = line
  }
  // Running the loop (rather than sleeping) keeps NSWorkspace's app list current.
  RunLoop.current.run(until: Date().addingTimeInterval(1.5))
}
