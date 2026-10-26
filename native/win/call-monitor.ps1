# Reports which programs are capturing from a microphone, for Heard's call detection on Windows.
# It reads Core Audio's list of audio sessions (what the volume mixer shows), so it never opens a
# device or hears audio. Windows' own usage record in the registry stopped updating on some builds.
#
# Prints one JSON line whenever the set changes: {"sessions":[[exe, parent exe, ...], ...]}, one
# entry per process with an active capture session, with up to three of its parents (WhatsApp and
# the new Teams capture in a WebView2 child process). The capture of the process with id -OwnerPid
# (Heard itself) is left out. Exits when that process is gone.
param([int]$OwnerPid)

$ErrorActionPreference = 'Stop'

Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace HeardCallMonitor {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumerator { }

  // Only the methods used are declared; each interface lists its vtable in order up to the last one used.
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
  }

  [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int Item(uint index, out IMMDevice device);
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
  }

  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    [PreserveSig] int GetAudioSessionControl(IntPtr sessionGuid, int flags, out IntPtr control);
    [PreserveSig] int GetSimpleAudioVolume(IntPtr sessionGuid, int flags, out IntPtr volume);
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
  }

  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetSession(int index, [MarshalAs(UnmanagedType.IUnknown)] out object session);
  }

  [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    [PreserveSig] int GetState(out int state);
    [PreserveSig] int GetDisplayName(out IntPtr name);
    [PreserveSig] int SetDisplayName(IntPtr name, IntPtr context);
    [PreserveSig] int GetIconPath(out IntPtr path);
    [PreserveSig] int SetIconPath(IntPtr path, IntPtr context);
    [PreserveSig] int GetGroupingParam(out Guid grouping);
    [PreserveSig] int SetGroupingParam(IntPtr grouping, IntPtr context);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr client);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr client);
    [PreserveSig] int GetSessionIdentifier(out IntPtr id);
    [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr id);
    [PreserveSig] int GetProcessId(out uint pid);
  }

  public static class Monitor {
    const int CaptureFlow = 1, ActiveDevices = 1, AllContexts = 23, ActiveSession = 1, MaxDepth = 4;
    const uint SnapProcesses = 2, QueryLimitedInformation = 0x1000;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct ProcessEntry {
      public uint dwSize;
      public uint cntUsage;
      public uint th32ProcessID;
      public IntPtr th32DefaultHeapID;
      public uint th32ModuleID;
      public uint cntThreads;
      public uint th32ParentProcessID;
      public int pcPriClassBase;
      public uint dwFlags;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
    }

    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder name, ref uint size);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    static void Release(object o) {
      if (o != null && Marshal.IsComObject(o)) Marshal.ReleaseComObject(o);
    }

    /** Ids of processes with an active session on any microphone. */
    static List<uint> CapturingProcesses() {
      var pids = new List<uint>();
      var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
      IMMDeviceCollection devices = null;
      try {
        if (enumerator.EnumAudioEndpoints(CaptureFlow, ActiveDevices, out devices) != 0) return pids;
        uint count;
        devices.GetCount(out count);
        Guid managerId = typeof(IAudioSessionManager2).GUID;
        for (uint i = 0; i < count; i++) {
          IMMDevice device = null;
          object manager = null;
          IAudioSessionEnumerator sessions = null;
          try {
            if (devices.Item(i, out device) != 0) continue;
            if (device.Activate(ref managerId, AllContexts, IntPtr.Zero, out manager) != 0) continue;
            if (((IAudioSessionManager2)manager).GetSessionEnumerator(out sessions) != 0) continue;
            int n;
            sessions.GetCount(out n);
            for (int j = 0; j < n; j++) {
              object session = null;
              try {
                if (sessions.GetSession(j, out session) != 0) continue;
                var control = session as IAudioSessionControl2;
                int state;
                uint pid;
                // GetProcessId returns a success code other than 0 for sessions spanning processes.
                if (control != null && control.GetState(out state) == 0 && state == ActiveSession &&
                    control.GetProcessId(out pid) >= 0 && pid != 0 && !pids.Contains(pid)) {
                  pids.Add(pid);
                }
              } finally {
                Release(session);
              }
            }
          } finally {
            Release(sessions);
            Release(manager);
            Release(device);
          }
        }
      } finally {
        Release(devices);
        Release(enumerator);
      }
      return pids;
    }

    static string PathOf(uint pid) {
      IntPtr process = OpenProcess(QueryLimitedInformation, false, pid);
      if (process == IntPtr.Zero) return null;
      try {
        var name = new StringBuilder(1024);
        uint size = (uint)name.Capacity;
        return QueryFullProcessImageNameW(process, 0, name, ref size) ? name.ToString() : null;
      } finally {
        CloseHandle(process);
      }
    }

    // Pure ASCII, so the line survives whatever code page the console pipe uses.
    static string Json(string s) {
      var json = new StringBuilder("\"");
      foreach (char c in s) {
        if (c < 0x20 || c > 0x7E) json.Append("\\u").Append(((int)c).ToString("x4"));
        else if (c == '\\' || c == '"') json.Append('\\').Append(c);
        else json.Append(c);
      }
      return json.Append('"').ToString();
    }

    public static string Report(int ownerPid) {
      var pids = CapturingProcesses();
      var parents = new Dictionary<uint, uint>();
      var names = new Dictionary<uint, string>();
      IntPtr snapshot = CreateToolhelp32Snapshot(SnapProcesses, 0);
      if (snapshot != new IntPtr(-1)) {
        try {
          var entry = new ProcessEntry();
          entry.dwSize = (uint)Marshal.SizeOf(typeof(ProcessEntry));
          if (Process32FirstW(snapshot, ref entry)) {
            do {
              parents[entry.th32ProcessID] = entry.th32ParentProcessID;
              names[entry.th32ProcessID] = entry.szExeFile;
            } while (Process32NextW(snapshot, ref entry));
          }
        } finally {
          CloseHandle(snapshot);
        }
      }

      string ownerPath = PathOf((uint)ownerPid);
      var chains = new List<string>();
      foreach (uint pid in pids) {
        var chain = new List<string>();
        bool ours = false;
        uint current = pid;
        for (int depth = 0; depth < MaxDepth && names.ContainsKey(current); depth++) {
          if (current == (uint)ownerPid) {
            // Heard's own capture runs in a child process of the same exe. A browser that
            // Heard happened to open (a link, a Gmail draft) is its child too, but counts.
            ours = chain.TrueForAll(path => ownerPath != null && string.Equals(path, ownerPath, StringComparison.OrdinalIgnoreCase));
            break;
          }
          chain.Add(PathOf(current) ?? names[current]);
          uint parent;
          if (!parents.TryGetValue(current, out parent) || parent == 0 || parent == current) break;
          current = parent;
        }
        if (!ours && chain.Count > 0) chains.Add("[" + string.Join(",", chain.ConvertAll(Json).ToArray()) + "]");
      }
      chains.Sort(StringComparer.Ordinal);
      return "{\"sessions\":[" + string.Join(",", chains.ToArray()) + "]}";
    }
  }
}
'@

$last = $null
while ($true) {
  try { [void][System.Diagnostics.Process]::GetProcessById($OwnerPid) } catch { exit 0 }
  try {
    $report = [HeardCallMonitor.Monitor]::Report($OwnerPid)
  } catch {
    [Console]::Error.WriteLine("Audio session check failed: $($_.Exception.Message)")
    $report = '{"sessions":[]}'
  }
  if ($report -ne $last) {
    [Console]::Out.WriteLine($report)
    [Console]::Out.Flush()
    $last = $report
  }
  Start-Sleep -Milliseconds 1500
}
