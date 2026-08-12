# Does a process tree actually produce sound?
#
# Every previous check asked each app whether it thought it was playing, using
# whatever it happened to log. That is not symmetric: Nemora forwards renderer
# console errors to stderr, Electron does not, so the same check was strict for
# one and blind for the other. Windows itself knows the answer: an application
# rendering audio owns a session on the output device, and that session has a
# peak meter. A non-zero peak is sound leaving the app, whatever it believes.
param(
  [Parameter(Mandatory = $true)][int]$RootPid,
  [int]$Seconds = 10
)

Add-Type -Language CSharp @"
using System;
using System.Runtime.InteropServices;

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

[Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
// Vtable order matters and is easy to get wrong: IAudioSessionControl
// contributes NINE methods (GetState, Get/SetDisplayName, Get/SetIconPath,
// Get/SetGroupingParam, Register/UnregisterAudioSessionNotification), then
// IAudioSessionControl2 adds GetSessionIdentifier and
// GetSessionInstanceIdentifier before GetProcessId. Eleven placeholders, not
// ten; one short and every call reads the wrong slot and quietly returns
// nothing, which looks exactly like "no app is playing".
public interface IAudioSessionControl2 {
  int NotImpl0(); int NotImpl1(); int NotImpl2(); int NotImpl3(); int NotImpl4();
  int NotImpl5(); int NotImpl6(); int NotImpl7(); int NotImpl8(); int NotImpl9();
  int NotImpl10();
  int GetProcessId(out uint pRetVal);
}

[Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioMeterInformation { int GetPeakValue(out float pfPeak); }

public static class AudioProbe {
  public static float PeakForPids(System.Collections.Generic.HashSet<uint> pids) {
    var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
    IMMDevice device;
    if (enumerator.GetDefaultAudioEndpoint(0, 1, out device) != 0) return -1f;

    Guid managerId = typeof(IAudioSessionManager2).GUID;
    object managerObject;
    if (device.Activate(ref managerId, 1, IntPtr.Zero, out managerObject) != 0) return -1f;
    var manager = (IAudioSessionManager2)managerObject;

    IAudioSessionEnumerator sessions;
    if (manager.GetSessionEnumerator(out sessions) != 0) return -1f;
    int count;
    sessions.GetCount(out count);

    float best = 0f;
    for (int i = 0; i < count; i++) {
      IAudioSessionControl control;
      if (sessions.GetSession(i, out control) != 0) continue;
      var control2 = control as IAudioSessionControl2;
      var meter = control as IAudioMeterInformation;
      if (control2 == null || meter == null) continue;
      uint owner;
      if (control2.GetProcessId(out owner) != 0) continue;
      if (!pids.Contains(owner)) continue;
      float peak;
      if (meter.GetPeakValue(out peak) == 0 && peak > best) best = peak;
    }
    return best;
  }
}
"@

$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
$want = New-Object 'System.Collections.Generic.HashSet[uint32]'
[void]$want.Add([uint32]$RootPid)
for ($i = 0; $i -lt 8; $i++) {
  foreach ($p in $all) {
    if ($want.Contains([uint32]$p.ParentProcessId)) { [void]$want.Add([uint32]$p.ProcessId) }
  }
}

# CPU is sampled over the SAME window as the audio, so a run can never report
# a cost for a period it was not actually playing. That decoupling is what let
# an app sitting on an error dialog be published as a playback measurement.
function Get-TreeCpuSeconds {
  $sum = 0.0
  foreach ($id in $want) {
    $p = Get-Process -Id ([int]$id) -ErrorAction SilentlyContinue
    if ($p) { $sum += $p.TotalProcessorTime.TotalSeconds }
  }
  return $sum
}

$cpuBefore = Get-TreeCpuSeconds
$startedAt = Get-Date
$peak = 0.0
$samples = 0
for ($i = 0; $i -lt ($Seconds * 4); $i++) {
  $value = [AudioProbe]::PeakForPids($want)
  if ($value -gt $peak) { $peak = $value }
  if ($value -gt 0.0005) { $samples++ }
  Start-Sleep -Milliseconds 250
}
$elapsed = ((Get-Date) - $startedAt).TotalSeconds
$cpuPercent = ((Get-TreeCpuSeconds) - $cpuBefore) / $elapsed * 100

$workingSet = 0
foreach ($id in $want) {
  $p = Get-Process -Id ([int]$id) -ErrorAction SilentlyContinue
  if ($p) { $workingSet += $p.WorkingSet64 }
}

[pscustomobject]@{
  peak          = [math]::Round($peak, 5)
  audibleTicks  = $samples
  totalTicks    = $Seconds * 4
  producedSound = ($samples -gt 4)
  cpuPercent    = [math]::Round($cpuPercent, 2)
  workingSetMb  = [math]::Round($workingSet / 1MB, 0)
} | ConvertTo-Json -Compress
