# The benchmark's only instrument: one long-lived process that watches a process tree from outside.
#
# Protocol on stdin/stdout, one line each:
#   <- ready                       compiled and waiting
#   -> watch <pid>                 start sampling the tree under <pid>
#   <- {"k":"w","t":...}           the tree's first visible window (once)
#   <- {"k":"a","t":...,"p":...,"q":...}  the audio peak of the tree's sessions (p) and of every
#                                  other app's (q), 0 when silent (every 25 ms)
#   <- {"k":"m","t":...,...}       CPU and memory of the whole tree (every 250 ms)
#   <- {"k":"s","t":...,"d":...}   with -Capture: a silence of d ms in what the device plays
#   -> stop                        exit
#
# Everything is read from Windows itself, never from the app: whether a window is on screen,
# whether sound leaves the process (the audio session peak meter), what the tree costs.
#
# The peak meter answers "is there sound" but Windows refreshes it only every few tens of ms and
# reports the loudest moment of that period, so a short silence inside loud music never shows on it.
# -Capture records the device's output itself (WASAPI loopback) and finds silences to the
# millisecond; it is what the gap between two songs is measured with.
param([switch]$Capture)
$ErrorActionPreference = 'Stop'

Add-Type -Language CSharp @"
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] public class MMDeviceEnumerator { }

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
  int NotImpl1();
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
  int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
}

[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionManager2 {
  int NotImpl1(); int NotImpl2();
  int GetSessionEnumerator(out IAudioSessionEnumerator SessionEnum);
}

[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionEnumerator {
  int GetCount(out int SessionCount);
  int GetSession(int SessionCount, out IAudioSessionControl Session);
}

[Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionControl { int NotImpl0(); int NotImpl1(); }

// IAudioSessionControl contributes NINE methods, then IAudioSessionControl2 adds
// GetSessionIdentifier and GetSessionInstanceIdentifier before GetProcessId: eleven placeholders.
// One short and every call reads the wrong slot and quietly returns nothing, which looks exactly
// like "no app is playing".
[Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionControl2 {
  int NotImpl0(); int NotImpl1(); int NotImpl2(); int NotImpl3(); int NotImpl4();
  int NotImpl5(); int NotImpl6(); int NotImpl7(); int NotImpl8(); int NotImpl9();
  int NotImpl10();
  int GetProcessId(out uint pRetVal);
}

[Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioMeterInformation { int GetPeakValue(out float pfPeak); }

[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ISimpleAudioVolume {
  int SetMasterVolume(float fLevel, ref Guid EventContext);
  int GetMasterVolume(out float pfLevel);
  int SetMute(bool bMute, ref Guid EventContext);
  int GetMute(out bool pbMute);
}

[Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioClient {
  int Initialize(int shareMode, uint streamFlags, long hnsBufferDuration, long hnsPeriodicity, IntPtr pFormat, IntPtr audioSessionGuid);
  int GetBufferSize(out uint pNumBufferFrames);
  int GetStreamLatency(out long phnsLatency);
  int GetCurrentPadding(out uint pNumPaddingFrames);
  int IsFormatSupported(int shareMode, IntPtr pFormat, out IntPtr ppClosestMatch);
  int GetMixFormat(out IntPtr ppDeviceFormat);
  int GetDevicePeriod(out long phnsDefaultDevicePeriod, out long phnsMinimumDevicePeriod);
  int Start();
  int Stop();
  int Reset();
  int SetEventHandle(IntPtr eventHandle);
  int GetService(ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object ppv);
}

[Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioCaptureClient {
  int GetBuffer(out IntPtr ppData, out uint pNumFramesToRead, out uint pdwFlags, out ulong pu64DevicePosition, out ulong pu64QPCPosition);
  int ReleaseBuffer(uint NumFramesRead);
  int GetNextPacketSize(out uint pNumFramesInNextPacket);
}

/// The device's output, recorded through WASAPI loopback, reduced to its silences.
public static class Loopback {
  public static readonly ConcurrentQueue<string> Events = new ConcurrentQueue<string>();
  public static string Error;

  public static void Start() {
    var thread = new Thread(() => {
      try { Run(BenchSampler.Stopped); } catch (Exception e) { Error = e.Message; Events.Enqueue("{\"k\":\"e\",\"msg\":\"loopback: " + e.Message.Replace("\"", "'") + "\"}"); }
    });
    thread.IsBackground = true;
    thread.Start();
  }

  static void Check(int hr, string what) { if (hr != 0) throw new Exception(what + " failed 0x" + hr.ToString("X8")); }

  static void Run(Func<bool> stopRequested) {
    var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
    IMMDevice device;
    Check(enumerator.GetDefaultAudioEndpoint(0, 1, out device), "GetDefaultAudioEndpoint");
    Guid clientId = typeof(IAudioClient).GUID; object obj;
    Check(device.Activate(ref clientId, 1, IntPtr.Zero, out obj), "Activate IAudioClient");
    var client = (IAudioClient)obj;
    IntPtr format;
    Check(client.GetMixFormat(out format), "GetMixFormat");
    int tag = Marshal.ReadInt16(format, 0) & 0xFFFF;
    int channels = Marshal.ReadInt16(format, 2);
    int rate = Marshal.ReadInt32(format, 4);
    int bits = Marshal.ReadInt16(format, 14);
    bool isFloat = tag == 3 || (tag == 0xFFFE && Marshal.ReadInt32(format, 24) == 3);
    // Shared mode, loopback, a one-second buffer drained every few ms.
    Check(client.Initialize(0, 0x00020000, 10000000, 0, format, IntPtr.Zero), "Initialize");
    Guid captureId = typeof(IAudioCaptureClient).GUID; object captureObj;
    Check(client.GetService(ref captureId, out captureObj), "GetService");
    var capture = (IAudioCaptureClient)captureObj;

    // QPC positions are in 100 ns units on the same clock as Stopwatch; one reference maps them to
    // wall-clock milliseconds, the clock every other event uses.
    long refUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    double ref100ns = Stopwatch.GetTimestamp() * (10000000.0 / Stopwatch.Frequency);
    Check(client.Start(), "Start");
    Events.Enqueue("{\"k\":\"l\",\"rate\":" + rate + ",\"channels\":" + channels + ",\"bits\":" + bits + ",\"float\":" + (isFloat ? "true" : "false") + "}");

    // -80 dBFS: below it a frame counts as silent. Runs of 2 ms or more are reported.
    const double threshold = 0.0001;
    int minRun = Math.Max(1, rate / 500);
    bool silent = false;
    double silenceStartMs = 0;
    long silentFrames = 0;
    int bytesPerSample = bits / 8;
    while (!stopRequested()) {
      Thread.Sleep(4);
      uint packet;
      while (capture.GetNextPacketSize(out packet) == 0 && packet > 0) {
        IntPtr data; uint frames, flags; ulong devicePosition, qpc;
        Check(capture.GetBuffer(out data, out frames, out flags, out devicePosition, out qpc), "GetBuffer");
        double packetMs = refUnixMs + (qpc - ref100ns) / 10000.0;
        bool allSilent = (flags & 0x2) != 0;
        for (int f = 0; f < frames; f++) {
          double peak = 0;
          if (!allSilent) {
            for (int c = 0; c < channels; c++) {
              int offset = (f * channels + c) * bytesPerSample;
              double v;
              if (isFloat) v = BitConverter.ToSingle(BitConverter.GetBytes(Marshal.ReadInt32(data, offset)), 0);
              else if (bits == 16) v = Marshal.ReadInt16(data, offset) / 32768.0;
              else v = Marshal.ReadInt32(data, offset) / 2147483648.0;
              if (Math.Abs(v) > peak) peak = Math.Abs(v);
            }
          }
          if (peak < threshold) {
            if (!silent) { silent = true; silenceStartMs = packetMs + f * 1000.0 / rate; silentFrames = 0; }
            silentFrames++;
          } else if (silent) {
            silent = false;
            if (silentFrames >= minRun) {
              double ms = silentFrames * 1000.0 / rate;
              Events.Enqueue("{\"k\":\"s\",\"t\":" + (long)silenceStartMs + ",\"d\":" + ms.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) + "}");
            }
          }
        }
        capture.ReleaseBuffer(frames);
      }
    }
    client.Stop();
  }
}

public static class BenchSampler {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct PROCESSENTRY32 {
    public uint dwSize; public uint cntUsage; public uint th32ProcessID; public IntPtr th32DefaultHeapID;
    public uint th32ModuleID; public uint cntThreads; public uint th32ParentProcessID; public int pcPriClassBase;
    public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_MEMORY_COUNTERS_EX2 {
    public uint cb; public uint PageFaultCount; public UIntPtr PeakWorkingSetSize; public UIntPtr WorkingSetSize;
    public UIntPtr QuotaPeakPagedPoolUsage; public UIntPtr QuotaPagedPoolUsage; public UIntPtr QuotaPeakNonPagedPoolUsage;
    public UIntPtr QuotaNonPagedPoolUsage; public UIntPtr PagefileUsage; public UIntPtr PeakPagefileUsage;
    public UIntPtr PrivateUsage; public UIntPtr PrivateWorkingSetSize; public ulong SharedCommitUsage;
  }

  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snap, ref PROCESSENTRY32 entry);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr snap, ref PROCESSENTRY32 entry);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);
  [DllImport("kernel32.dll")] static extern bool GetProcessHandleCount(IntPtr process, out uint count);
  [DllImport("psapi.dll")] static extern bool GetProcessMemoryInfo(IntPtr process, ref PROCESS_MEMORY_COUNTERS_EX2 counters, uint size);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [StructLayout(LayoutKind.Sequential)]
  struct IO_COUNTERS {
    public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
    public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
  }
  [DllImport("kernel32.dll")] static extern bool GetProcessIoCounters(IntPtr process, out IO_COUNTERS counters);

  delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }

  const uint QUERY = 0x1000; // PROCESS_QUERY_LIMITED_INFORMATION
  static readonly Dictionary<uint, long> lastCpu = new Dictionary<uint, long>();
  static long cpuTotal = 0;
  static readonly Dictionary<uint, ulong> lastRead = new Dictionary<uint, ulong>();
  static readonly Dictionary<uint, ulong> lastWrite = new Dictionary<uint, ulong>();
  static ulong readTotal = 0, writeTotal = 0;
  static uint rootPid;
  static HashSet<uint> tree = new HashSet<uint>();
  static IAudioSessionManager2 manager;
  /// The loudest session NOT in the tree at the last Peak(): another app playing over the run.
  public static float Others;
  public static uint OthersPid;
  static readonly uint self = (uint)Process.GetCurrentProcess().Id;
  public static bool Stopped() { return StopRequested; }

  public static void Watch(uint pid) {
    rootPid = pid; lastCpu.Clear(); cpuTotal = 0; lastRead.Clear(); lastWrite.Clear(); readTotal = 0; writeTotal = 0;
    tree = new HashSet<uint> { pid };
  }

  /// Counters only grow; a process seen for the first time contributes all it has done so far.
  static ulong Accumulate(Dictionary<uint, ulong> last, uint pid, ulong now) {
    ulong before; ulong delta = last.TryGetValue(pid, out before) ? (now > before ? now - before : 0) : now;
    last[pid] = now;
    return delta;
  }

  /// Set when stdin says stop or closes. Read on a thread of its own: Console.In.ReadLineAsync
  /// blocks under Windows PowerShell, which would stall the sampling loop until the next line.
  public static volatile bool StopRequested;
  public static void ListenForStop() {
    var reader = new System.Threading.Thread(() => {
      string line;
      while ((line = Console.In.ReadLine()) != null) { if (line == "stop") break; }
      StopRequested = true;
    });
    reader.IsBackground = true;
    reader.Start();
  }

  /// Descendants by parent id, kept across samples so a child that outlives its parent still counts.
  public static int RefreshTree() {
    var parents = new Dictionary<uint, uint>();
    IntPtr snap = CreateToolhelp32Snapshot(2, 0);
    var entry = new PROCESSENTRY32 { dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32)) };
    if (Process32FirstW(snap, ref entry)) {
      do { parents[entry.th32ProcessID] = entry.th32ParentProcessID; } while (Process32NextW(snap, ref entry));
    }
    CloseHandle(snap);
    tree.RemoveWhere(p => !parents.ContainsKey(p));
    bool grew = true;
    while (grew) {
      grew = false;
      foreach (var pair in parents) {
        if (!tree.Contains(pair.Key) && tree.Contains(pair.Value) && pair.Key != pair.Value) { tree.Add(pair.Key); grew = true; }
      }
    }
    return tree.Count;
  }

  public static bool RootAlive() {
    IntPtr h = OpenProcess(QUERY, false, rootPid);
    if (h == IntPtr.Zero) return false;
    uint code; bool alive = GetExitCodeProcess(h, out code) && code == 259;
    CloseHandle(h);
    return alive;
  }

  /// CPU is accumulated per process, so a child that exits takes nothing back from the total.
  public static string Metrics(long t) {
    long ws = 0, priv = 0, pws = 0; uint handles = 0;
    foreach (var pid in tree) {
      IntPtr h = OpenProcess(QUERY, false, pid);
      if (h == IntPtr.Zero) continue;
      long c, e, k, u;
      if (GetProcessTimes(h, out c, out e, out k, out u)) {
        long now = k + u, before;
        if (lastCpu.TryGetValue(pid, out before)) cpuTotal += Math.Max(0, now - before); else cpuTotal += now;
        lastCpu[pid] = now;
      }
      var m = new PROCESS_MEMORY_COUNTERS_EX2 { cb = (uint)Marshal.SizeOf(typeof(PROCESS_MEMORY_COUNTERS_EX2)) };
      if (GetProcessMemoryInfo(h, ref m, m.cb)) {
        ws += (long)m.WorkingSetSize.ToUInt64(); priv += (long)m.PrivateUsage.ToUInt64(); pws += (long)m.PrivateWorkingSetSize.ToUInt64();
      }
      uint hc; if (GetProcessHandleCount(h, out hc)) handles += hc;
      // All I/O the process asked for, disk mostly: the players are offline under the harness.
      IO_COUNTERS io;
      if (GetProcessIoCounters(h, out io)) {
        readTotal += Accumulate(lastRead, pid, io.ReadTransferCount);
        writeTotal += Accumulate(lastWrite, pid, io.WriteTransferCount);
      }
      CloseHandle(h);
    }
    return "{\"k\":\"m\",\"t\":" + t + ",\"n\":" + tree.Count + ",\"cpu\":" + (cpuTotal / 10000) + ",\"ws\":" + ws + ",\"priv\":" + priv + ",\"pws\":" + pws + ",\"h\":" + handles + ",\"rd\":" + readTotal + ",\"wr\":" + writeTotal + "}";
  }

  /// A window of the tree that is visible, not cloaked by DWM, and bigger than a splinter.
  public static bool HasVisibleWindow() {
    bool found = false;
    EnumWindows((hwnd, l) => {
      uint pid; GetWindowThreadProcessId(hwnd, out pid);
      if (!tree.Contains(pid) || !IsWindowVisible(hwnd)) return true;
      int cloaked; if (DwmGetWindowAttribute(hwnd, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      RECT r; if (!GetWindowRect(hwnd, out r) || r.Right - r.Left < 200 || r.Bottom - r.Top < 150) return true;
      found = true; return false;
    }, IntPtr.Zero);
    return found;
  }

  public static float Peak() {
    try {
      if (manager == null) {
        var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
        IMMDevice device;
        if (enumerator.GetDefaultAudioEndpoint(0, 1, out device) != 0) return -1f;
        Guid id = typeof(IAudioSessionManager2).GUID; object obj;
        if (device.Activate(ref id, 1, IntPtr.Zero, out obj) != 0) return -1f;
        manager = (IAudioSessionManager2)obj;
      }
      IAudioSessionEnumerator sessions;
      if (manager.GetSessionEnumerator(out sessions) != 0) return -1f;
      int count; sessions.GetCount(out count);
      float best = 0f, others = 0f;
      OthersPid = 0;
      for (int i = 0; i < count; i++) {
        IAudioSessionControl control;
        if (sessions.GetSession(i, out control) != 0) continue;
        var control2 = control as IAudioSessionControl2; var meter = control as IAudioMeterInformation;
        if (control2 == null || meter == null) continue;
        uint owner; if (control2.GetProcessId(out owner) != 0) continue;
        float peak; if (meter.GetPeakValue(out peak) != 0) continue;
        if (tree.Contains(owner)) { if (peak > best) best = peak; }
        // The loopback capture is a session of this very process, metering the whole mix.
        else if (owner != self) {
          // The meter reads before the session's own volume: a muted app still shows a peak, but
          // adds nothing to what the device plays (OBS monitoring, for one).
          var volume = control as ISimpleAudioVolume;
          float level = 1f; bool muted = false;
          if (volume != null) { volume.GetMasterVolume(out level); volume.GetMute(out muted); }
          float heard = muted ? 0f : peak * level;
          if (heard > others) { others = heard; OthersPid = owner; }
        }
      }
      Others = others;
      return best;
    } catch { manager = null; return -1f; }
  }
}
"@

[Console]::Out.WriteLine('ready')
[Console]::Out.Flush()
$line = [Console]::In.ReadLine()
if (-not $line -or -not $line.StartsWith('watch ')) { exit 0 }
[BenchSampler]::Watch([uint32]$line.Substring(6))
[BenchSampler]::ListenForStop()
if ($Capture) { [Loopback]::Start() }

$windowSeen = $false
$tick = 0
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$culture = [System.Globalization.CultureInfo]::InvariantCulture
while (-not [BenchSampler]::StopRequested) {
  $t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  [void][BenchSampler]::RefreshTree()
  if (-not $windowSeen -and [BenchSampler]::HasVisibleWindow()) {
    $windowSeen = $true
    [Console]::Out.WriteLine('{"k":"w","t":' + $t + '}')
  }
  # Every tick, silent ones included: a missing tick (the loop ran late) is not silence, and only
  # an explicit zero lets the harness tell the two apart.
  $peak = [BenchSampler]::Peak()
  [Console]::Out.WriteLine('{"k":"a","t":' + $t + ',"p":' + $peak.ToString('0.#####', $culture) + ',"q":' + [BenchSampler]::Others.ToString('0.#####', $culture) + ',"qp":' + [BenchSampler]::OthersPid + '}')
  $event = $null
  while ([Loopback]::Events.TryDequeue([ref]$event)) { [Console]::Out.WriteLine($event) }
  if ($tick % 10 -eq 0) {
    [Console]::Out.WriteLine([BenchSampler]::Metrics($t))
    if (-not [BenchSampler]::RootAlive()) { [Console]::Out.WriteLine('{"k":"x","t":' + $t + '}') }
  }
  [Console]::Out.Flush()
  $tick++
  # A steady 25 ms cadence, whatever one sample took.
  $next = $tick * 25
  $wait = $next - $clock.ElapsedMilliseconds
  if ($wait -gt 0) { Start-Sleep -Milliseconds $wait }
}
