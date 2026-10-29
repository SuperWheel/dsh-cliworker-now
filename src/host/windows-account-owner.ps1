param([Parameter(Mandatory=$true)][string]$Directory, [Parameter(Mandatory=$true)][int]$HostProcessId)
$ErrorActionPreference = 'Stop'
# Fixed process ownership only: no resource, privilege, network, or filesystem limits.
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.ComponentModel;
using System.Runtime.InteropServices;
public sealed class CwnAccountJob : IDisposable {
 [StructLayout(LayoutKind.Sequential)] struct BasicLimits { public long ProcessTime, JobTime; public uint Flags; public UIntPtr MinWorking, MaxWorking; public uint ActiveLimit; public UIntPtr Affinity; public uint Priority, Scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct Io { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
 [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits { public BasicLimits Basic; public Io Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory; }
 [StructLayout(LayoutKind.Sequential)] struct Accounting { public long User, Kernel, PeriodUser, PeriodKernel; public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses; }
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct ProcessEntry { public uint Size, Usage, ProcessId; public UIntPtr DefaultHeap; public uint ModuleId, Threads, ParentProcessId; public int Priority; public uint Flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string Image; }
 [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attr, string name);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint size);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting info, uint size, IntPtr length);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll")] static extern bool FreeConsole();
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool AttachConsole(uint pid);
 [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
 [DllImport("user32.dll", SetLastError=true)] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr GetModuleHandle(string name);
 [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr GetProcAddress(IntPtr module, IntPtr ordinal);
 [UnmanagedFunctionPointer(CallingConvention.Winapi)] delegate uint RealWindowOwner(IntPtr window);
 IntPtr job; Process root;
 public CwnAccountJob() { job=CreateJobObject(IntPtr.Zero,null); if(job==IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error()); var l=new ExtendedLimits(); l.Basic.Flags=0x2000; if(!SetInformationJobObject(job,9,ref l,(uint)Marshal.SizeOf(l))) { var error=Marshal.GetLastWin32Error(); Dispose(); throw new Win32Exception(error); } }
 public void Attach(int pid, DateTime receiptTime, DateTime earliest) { root=Process.GetProcessById(pid); var handle=root.Handle; var started=root.StartTime.ToUniversalTime(); if(started>receiptTime || started<earliest) throw new Exception("process identity changed"); if(!AssignProcessToJobObject(job,handle)) throw new Win32Exception(Marshal.GetLastWin32Error()); }
 // The parent check needs one PID, not WMI/CIM provider initialization. Keep
 // the process handle open while taking the snapshot to prevent PID recycling.
 // A missing/exited process or snapshot error still fails closed.
 public static int ParentProcessId(int pid) {
  using(var process=Process.GetProcessById(pid)) {
   var handle=process.Handle;
   var snapshot=CreateToolhelp32Snapshot(2,0);
   if(snapshot==new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
   try {
    var entry=new ProcessEntry(); entry.Size=(uint)Marshal.SizeOf(typeof(ProcessEntry));
    if(!Process32FirstW(snapshot,ref entry)) throw new Win32Exception(Marshal.GetLastWin32Error());
    do {
     if(entry.ProcessId==(uint)pid) {
      if(process.HasExited || entry.ParentProcessId==0 || entry.ParentProcessId>Int32.MaxValue) throw new Exception("process identity changed");
      return (int)entry.ParentProcessId;
     }
    } while(Process32NextW(snapshot,ref entry));
    throw new Exception("process parent unavailable");
   } finally { CloseHandle(snapshot); }
  }
 }
 public static int ConsoleOwner(int pid) {
  FreeConsole(); if(!AttachConsole((uint)pid)) throw new Win32Exception(Marshal.GetLastWin32Error());
  try {
   var window=GetConsoleWindow(); uint owner;
   if(window==IntPtr.Zero || GetWindowThreadProcessId(window,out owner)==0 || owner==0) throw new Exception("console owner unavailable");
   // Modern ConPTY gives its message-only window to the root client, not
   // conhost: microsoft/terminal#14196. Resolve this same HWND's real owner
   // using the maintainer's dynamic API from discussion #16447. The ordinal
   // is not a stable public API; absence or an invalid result fails closed.
   if(owner==(uint)pid) {
    var module=GetModuleHandle("user32.dll");
    var address=module==IntPtr.Zero?IntPtr.Zero:GetProcAddress(module,new IntPtr(2712));
    if(address==IntPtr.Zero) throw new Exception("real console owner unavailable");
    var getOwner=(RealWindowOwner)Marshal.GetDelegateForFunctionPointer(address,typeof(RealWindowOwner));
    owner=getOwner(window);
   }
   if(owner==0 || owner>(uint)Int32.MaxValue || owner==(uint)pid) throw new Exception("console owner unavailable");
   return (int)owner;
  } finally { FreeConsole(); }
 }
 public string ConsoleIdentityReason { get; private set; }
 public string ConsoleImageKind { get; private set; }
 public bool ConsoleImageDevicePrefix { get; private set; }
 public static bool NoLinks(string path) {
  for(var current=System.IO.Path.GetFullPath(path);!String.IsNullOrEmpty(current);current=System.IO.Path.GetDirectoryName(current)) {
   if((System.IO.File.GetAttributes(current)&System.IO.FileAttributes.ReparsePoint)!=0) return false;
  }
  return true;
 }
 static string Hash(string path) {
  using(var stream=new System.IO.FileStream(path,System.IO.FileMode.Open,System.IO.FileAccess.Read,System.IO.FileShare.Read))
  using(var sha=System.Security.Cryptography.SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();
 }
 // These are the two Microsoft ConPTY payloads shipped by the lockfile's
 // official node-pty@1.2.0-beta.15 npm archive, not a process-name allowlist.
 public static bool TrustedNodePtyImage(string image,string packageRoot) {
  try {
   if(String.IsNullOrEmpty(packageRoot) || !String.Equals(System.IO.Path.GetFullPath(image),image,StringComparison.OrdinalIgnoreCase)) return false;
   var expected=System.IO.Path.Combine(packageRoot,"build","Release","conpty","OpenConsole.exe");
   var prebuiltX64=System.IO.Path.Combine(packageRoot,"prebuilds","win32-x64","conpty","OpenConsole.exe");
   var prebuiltArm64=System.IO.Path.Combine(packageRoot,"prebuilds","win32-arm64","conpty","OpenConsole.exe");
   var release=String.Equals(image,expected,StringComparison.OrdinalIgnoreCase);
   if((!release && !String.Equals(image,prebuiltX64,StringComparison.OrdinalIgnoreCase) && !String.Equals(image,prebuiltArm64,StringComparison.OrdinalIgnoreCase)) || !NoLinks(image)) return false;
   var dll=System.IO.Path.Combine(System.IO.Path.GetDirectoryName(image),"conpty.dll");
   if(!NoLinks(dll)) return false;
   var exeHash=Hash(image); var dllHash=Hash(dll); string architecture;
   if(exeHash=="7f68c840226505004215c0b82d4e502c24b5bc3f4b93c4baaaa19bd679c0def8" && dllHash=="3319b484b80bb53d1f4d0a9eb0ea60fd0f61da69db7280ca43b84215f19245ff") architecture="win10-x64";
   else if(exeHash=="7fa560be0c9b6c81db5d1b855a4a6e0f3ee5a2ea75d36eebb3ae44443b8d4866" && dllHash=="b3a9f975c51d5b9b96d290bf784e990e3f85203b063c21614457353f566266ff") architecture="win10-arm64";
   else return false;
   if(!release && !String.Equals(image,architecture=="win10-x64"?prebuiltX64:prebuiltArm64,StringComparison.OrdinalIgnoreCase)) return false;
   var source=System.IO.Path.Combine(packageRoot,"third_party","conpty","1.25.260303002",architecture);
   var sourceExe=System.IO.Path.Combine(source,"OpenConsole.exe"); var sourceDll=System.IO.Path.Combine(source,"conpty.dll");
   return NoLinks(sourceExe) && NoLinks(sourceDll) && Hash(sourceExe)==exeHash && Hash(sourceDll)==dllHash;
  } catch { return false; }
 }
 public void AttachConsoleHost(int pid, DateTime latest, DateTime earliest,string packageRoot) {
  using(var p=Process.GetProcessById(pid)) {
   var handle=p.Handle; var started=p.StartTime.ToUniversalTime();
   var expected=System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"conhost.exe");
   if(started>latest) { ConsoleIdentityReason="after-receipt"; throw new Exception("console identity changed"); }
   if(started<earliest) { ConsoleIdentityReason="before-directory"; throw new Exception("console identity changed"); }
   var image=p.MainModule.FileName; var leaf=System.IO.Path.GetFileName(image);
   ConsoleImageKind=String.Equals(leaf,"conhost.exe",StringComparison.OrdinalIgnoreCase)?"conhost.exe":String.Equals(leaf,"openconsole.exe",StringComparison.OrdinalIgnoreCase)?"openconsole.exe":"other";
   ConsoleImageDevicePrefix=image!=null && (image.StartsWith(@"\\?\") || image.StartsWith(@"\??\"));
   if(!String.Equals(image,expected,StringComparison.OrdinalIgnoreCase) && !TrustedNodePtyImage(image,packageRoot)) { ConsoleIdentityReason="wrong-image"; throw new Exception("console identity changed"); }
   if(!AssignProcessToJobObject(job,handle)) throw new Win32Exception(Marshal.GetLastWin32Error());
  }
 }
 public bool RootExited { get { return root.HasExited; } }
 public void Stop() { if(!TerminateJobObject(job,143)) throw new Win32Exception(Marshal.GetLastWin32Error()); }
 public bool Empty { get { Accounting a; if(!QueryInformationJobObject(job,1,out a,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error()); return a.ActiveProcesses==0; } }
 public void Dispose() { if(job!=IntPtr.Zero) { CloseHandle(job); job=IntPtr.Zero; } if(root!=null) root.Dispose(); }
}
'@
function Test-CwnManifestProof($Proof,$Request) {
  return $null -ne $Proof -and $Proof.nonce -ceq $Request.nonce -and $Proof.packageRoot -eq $Request.packageRoot -and $Proof.archivePath -eq $Request.archivePath -and $Proof.name -ceq 'node-pty' -and $Proof.version -ceq '1.2.0-beta.15'
}
function Get-CwnElectronManifest([string]$Root) {
  # The root is derived from the actual console image, never a provider lookup.
  $hostImage=(Get-Process -Id $HostProcessId -ErrorAction Stop).MainModule.FileName
  $resources=Join-Path (Split-Path $hostImage -Parent) 'resources'
  $expected=Join-Path $resources 'app.asar.unpacked/dsh/node_modules/node-pty'
  $archive=Join-Path $resources 'app.asar'
  if($Root -ne $expected -or ![CwnAccountJob]::NoLinks($hostImage) -or ![CwnAccountJob]::NoLinks($archive) -or ![CwnAccountJob]::NoLinks($Root)) { return $false }
  $script:CwnArchiveLock=New-Object System.IO.FileStream($archive,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  $request=@{nonce=[guid]::NewGuid().ToString('D');packageRoot=$Root;archivePath=$archive}
  $requestPath=Join-Path $Directory 'manifest-request'
  [IO.File]::WriteAllText(($requestPath+'.tmp'),($request|ConvertTo-Json -Compress))
  [IO.File]::Move(($requestPath+'.tmp'),$requestPath)
  $deadline=[DateTime]::UtcNow.AddSeconds(10)
  while([DateTime]::UtcNow -lt $deadline) {
    $proofPath=Join-Path $Directory 'manifest-proof'
    if(Test-Path -LiteralPath $proofPath) {
      $info=Get-Item -LiteralPath $proofPath -Force
      if($info.PSIsContainer -or $info.Length -gt 4096 -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return $false }
      try { $proof=Get-Content -LiteralPath $proofPath -Raw -Encoding UTF8|ConvertFrom-Json } catch { Start-Sleep -Milliseconds 10; continue }
      return (Test-CwnManifestProof $proof $request)
    }
    Start-Sleep -Milliseconds 15
  }
  return $false
}
function Get-TrustedNodePtyRoot([string]$Image) {
  try {
    $conpty=Split-Path -Path $Image -Parent
    $release=Split-Path -Path $conpty -Parent
    $build=Split-Path -Path $release -Parent
    $root=Split-Path -Path $build -Parent
    $stage=Split-Path -Path $build -Leaf
    $variant=Split-Path -Path $release -Leaf
    $layout=($stage -eq 'build' -and $variant -eq 'Release') -or ($stage -eq 'prebuilds' -and $variant -in @('win32-x64','win32-arm64'))
    if((Split-Path -Path $conpty -Leaf) -ne 'conpty' -or !$layout -or (Split-Path -Path $root -Leaf) -ne 'node-pty') { return $null }
    $manifest=Join-Path $root 'package.json'
    if(Test-Path -LiteralPath $manifest) {
      $info=Get-Item -LiteralPath $manifest -Force
      if($info.PSIsContainer -or $info.Length -gt 65536 -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return $null }
      $package=Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
      if($package.name -ne 'node-pty' -or $package.version -ne '1.2.0-beta.15') { return $null }
    } elseif(!(Get-CwnElectronManifest $root)) { return $null }
    if(![CwnAccountJob]::TrustedNodePtyImage($Image,$root)) { return $null }
    return $root
  } catch { return $null }
}
$job=$null
$stage='await-bootstrap'
$consolePid=$null
$consoleParentPid=$null
try {
  $earliest=[System.IO.Directory]::GetCreationTimeUtc($Directory).AddSeconds(-1)
  $pidFile=Join-Path $Directory 'pid'
  $stopFile=Join-Path $Directory 'stop'
  [System.IO.File]::WriteAllText((Join-Path $Directory 'owner-ready'),'owner-ready')
  $until=[DateTime]::UtcNow.AddSeconds(15)
  while (!(Test-Path -LiteralPath $pidFile)) {
    if ([DateTime]::UtcNow -ge $until) { throw 'bootstrap timeout' }
    Start-Sleep -Milliseconds 20
  }
  $childPid=0
  if (![int]::TryParse([System.IO.File]::ReadAllText($pidFile),[ref]$childPid) -or $childPid -le 0) { throw 'invalid bootstrap receipt' }
  $stage='create-job'
  $job=New-Object CwnAccountJob
  $stage='attach-root'
  $job.Attach($childPid,[System.IO.File]::GetLastWriteTimeUtc($pidFile),$earliest)
  # The ConPTY console is a sibling of the bootstrap, created by the Host.
  # Resolve it through this exact console, then validate parent and creation
  # identity before adding it; never enumerate/kill processes by image name.
  $stage='resolve-console'
  $consolePid=[CwnAccountJob]::ConsoleOwner($childPid)
  $stage='validate-console-parent'
  $consoleParentPid=[CwnAccountJob]::ParentProcessId($consolePid)
  if ($consoleParentPid -ne $HostProcessId) { throw 'console owner mismatch' }
  $stage='attach-console'
  $consoleImage=(Get-Process -Id $consolePid).MainModule.FileName
  $packageRoot=Get-TrustedNodePtyRoot $consoleImage
  $job.AttachConsoleHost($consolePid,[System.IO.File]::GetLastWriteTimeUtc($pidFile),$earliest,$packageRoot)
  if($script:CwnArchiveLock) { $script:CwnArchiveLock.Dispose(); $script:CwnArchiveLock=$null }
  $stage='await-stop'
  [System.IO.File]::WriteAllText((Join-Path $Directory 'ready'),'ready')
  while (!$job.RootExited -and !(Test-Path -LiteralPath $stopFile)) { Start-Sleep -Milliseconds 50 }
  $stage='stop-job'
  $job.Stop()
  $stage='confirm-empty'
  $until=[DateTime]::UtcNow.AddSeconds(8)
  while (!$job.Empty) {
    if ([DateTime]::UtcNow -ge $until) { throw 'empty receipt timeout' }
    Start-Sleep -Milliseconds 20
  }
  [System.IO.File]::WriteAllText((Join-Path $Directory 'closed'),'closed')
  exit 0
} catch {
  # Fixed stage and numeric metadata only; no exception text/argv/environment.
  $failure=@{ stage=$stage; hostPid=$HostProcessId; ownerPid=$PID }
  if ($null -ne $consolePid) { $failure.consolePid=$consolePid }
  if ($null -ne $consoleParentPid) { $failure.consoleParentPid=$consoleParentPid }
  if ($null -ne $job -and $job.ConsoleIdentityReason -in @('before-directory','after-receipt','wrong-image')) {
    $failure.identityReason=$job.ConsoleIdentityReason
    if ($job.ConsoleImageKind -in @('conhost.exe','openconsole.exe','other')) {
      $failure.imageKind=$job.ConsoleImageKind
      $failure.imageDevicePrefix=$job.ConsoleImageDevicePrefix
    }
  }
  $errorObject=$_.Exception
  while ($null -ne $errorObject) {
    if ($errorObject -is [System.ComponentModel.Win32Exception]) { $failure.win32Code=$errorObject.NativeErrorCode; break }
    $errorObject=$errorObject.InnerException
  }
  try { [System.IO.File]::WriteAllText((Join-Path $Directory 'failure'),($failure | ConvertTo-Json -Compress)) } catch {}
  # Fixed classification only: never emit native exception/context/environment.
  [Console]::Error.WriteLine('Windows account process ownership failed')
  exit 2
} finally {
  if ($null -ne $job) { $job.Dispose() }
  if($script:CwnArchiveLock) { $script:CwnArchiveLock.Dispose(); $script:CwnArchiveLock=$null }
}
