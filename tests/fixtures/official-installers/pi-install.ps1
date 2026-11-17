#!/usr/bin/env pwsh

$ErrorActionPreference = "Stop"

$PiPackage = "@earendil-works/pi-coding-agent"
$PiCmd = "pi"
$PiInstallerApiBase = if ($env:PI_INSTALLER_API_BASE) { $env:PI_INSTALLER_API_BASE } else { "https://pi.dev/api/installer/releases" }
$PiManagedInstallMarker = "managed-install.json"
# Pi publishes npm-shrinkwrap.json, so the explicit installer/reinstaller can
# bypass npm's release-age gate without reopening transitive dependency ranges.
$NpmMinReleaseAgeArg = "--min-release-age=0"
$NodeMinimum = [version]"22.19.0"
$GitForWindowsLatestReleaseApi = "https://api.github.com/repos/git-for-windows/git/releases/latest"
$PiEsc = [char]27
$PiCr = [char]13

function Write-InstallerTitle {
  if (Test-InstallerAnsiOutput) {
    [Console]::Write("${PiEsc}[1m  Pi Installer${PiEsc}[0m`n${PiEsc}[2m  There are many coding agents, but this one is mine.${PiEsc}[0m`n`n")
  } else {
    Write-Host ""
    Write-Host "  Pi Installer"
    Write-Host "  There are many coding agents, but this one is mine."
    Write-Host ""
  }
}

function Test-InstallerInteractiveOutput {
  return (-not [Console]::IsOutputRedirected) -and ($env:TERM -ne "dumb")
}

function Enable-VirtualTerminalOutput {
  if (-not (Test-InstallerInteractiveOutput)) {
    return $false
  }

  if ($null -ne $script:PiVirtualTerminalEnabled) {
    return $script:PiVirtualTerminalEnabled
  }

  if (-not ("ConsoleMode.NativeMethods" -as [Type])) {
    Add-Type -Namespace ConsoleMode -Name NativeMethods -MemberDefinition @"
[DllImport("kernel32.dll", SetLastError = true)]
public static extern System.IntPtr GetStdHandle(int nStdHandle);

[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool GetConsoleMode(System.IntPtr hConsoleHandle, out uint lpMode);

[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool SetConsoleMode(System.IntPtr hConsoleHandle, uint dwMode);
"@
  }

  $stdOutputHandle = -11
  $enableVirtualTerminalProcessing = 0x0004
  $handle = [ConsoleMode.NativeMethods]::GetStdHandle($stdOutputHandle)
  $mode = [uint32]0
  $script:PiVirtualTerminalEnabled = [ConsoleMode.NativeMethods]::GetConsoleMode($handle, [ref]$mode) -and [ConsoleMode.NativeMethods]::SetConsoleMode($handle, ($mode -bor $enableVirtualTerminalProcessing))
  return $script:PiVirtualTerminalEnabled
}

function Test-InstallerAnsiOutput {
  return Enable-VirtualTerminalOutput
}

function Test-InstallerInteractiveInput {
  return -not [Console]::IsInputRedirected
}

function Test-TerminalSupportsUnicode {
  $locale = "$env:LC_ALL$env:LC_CTYPE$env:LANG"
  if ($locale -match "(?i)utf-?8") {
    return $true
  }

  if ($env:TERM_PROGRAM -in @("Apple_Terminal", "iTerm.app", "vscode", "WezTerm")) {
    return $true
  }

  if ($env:WT_SESSION -or $env:TERMINAL_EMULATOR) {
    return $true
  }

  return $false
}

function Get-SpinnerFrame {
  param([int]$Step)

  switch ($Step % 4) {
    0 { return "-" }
    1 { return "\" }
    2 { return "|" }
    default { return "/" }
  }
}

function Get-InstallLogLines {
  param([string]$LogFile)

  if (Test-Path $LogFile) {
    return Get-Content $LogFile
  }
  return @()
}

function Get-NpmInstallProgressLabel {
  param([string]$LogFile, [string]$CurrentLabel)

  $label = $CurrentLabel
  $metadataCacheCount = 0
  $metadataFetchCount = 0
  $tarballCacheCount = 0
  $tarballFetchCount = 0

  foreach ($line in (Get-InstallLogLines $LogFile)) {
    $line = ($line -split $PiCr)[-1]
    if ($line -like "Downloading managed installer release metadata*") {
      $label = "resolving managed release"
    } elseif ($line -like "Downloading managed installer package.json*") {
      $label = "fetching managed package manifest"
    } elseif ($line -like "Downloading managed installer package-lock.json*") {
      $label = "fetching managed package lock"
    } elseif ($line -like "Installing managed Pi dependencies*") {
      $label = "installing managed dependencies"
    } elseif ($line -like "Verifying managed Pi*") {
      $label = "verifying managed package"
    } elseif ($line -like "Activating managed Pi*") {
      $label = "activating managed package"
    } elseif ($line -like "Removing npm-installed Pi*") {
      $label = "removing npm-installed package"
    } elseif ($line -like "Managed Pi install complete*") {
      $label = "managed install complete"
    } elseif (($line -like "npm verbose title npm install*") -or ($line -like "npm verbose title npm ci*")) {
      $label = "resolving packages"
    } elseif ($line -match "npm http fetch GET .*https://registry\.npmjs\.org/.*\.tgz") {
      $tarballFetchCount += 1
      $label = "fetching tarballs ($tarballFetchCount)"
    } elseif ($line -match "npm http cache .*@https://registry\.npmjs\.org/.*\.tgz") {
      $tarballCacheCount += 1
      if ($tarballFetchCount -gt 0) {
        $label = "fetching tarballs ($tarballFetchCount)"
      } else {
        $label = "checking tarballs ($tarballCacheCount)"
      }
    } elseif ($line -match "npm http fetch GET .*https://registry\.npmjs\.org/") {
      $metadataFetchCount += 1
      $label = "fetching package metadata ($metadataFetchCount)"
    } elseif ($line -match "npm http cache https://registry\.npmjs\.org/") {
      $metadataCacheCount += 1
      if ($metadataFetchCount -gt 0) {
        $label = "fetching package metadata ($metadataFetchCount)"
      } else {
        $label = "checking cached metadata ($metadataCacheCount)"
      }
    } elseif ($line -like "npm info run *") {
      $rest = $line.Substring("npm info run ".Length)
      $parts = $rest -split " "
      $package = $parts[0]
      $script = if ($parts.Length -gt 1) { $parts[1] } else { "script" }
      $package = $package -replace "@[^@]*$", ""
      if ($line -like "*{ code:*") {
        $label = "finished $script for $package"
      } else {
        $label = "running $script for $package"
      }
    } elseif (($line -like "changed *") -or ($line -like "added *") -or ($line -like "removed *") -or ($line -like "updated *") -or ($line -like "up to date *")) {
      $label = $line
    }
  }

  if ($label.Length -gt 64) {
    $label = $label.Substring(0, 61) + "..."
  }
  return $label
}

function Get-VisibleTextLength {
  param([string]$Text)

  $escapedEsc = [regex]::Escape([string]$PiEsc)
  $visibleText = [regex]::Replace($Text, "${escapedEsc}\[[0-9;?]*[ -/]*[@-~]", "")
  return $visibleText.Length
}

function Write-InstallProgress {
  param([int]$Step, [string]$Frame, [string]$Label, [string]$Title)

  $reset = "${PiEsc}[0m"
  $dim = "${PiEsc}[2m"
  $coral = "${PiEsc}[38;2;240;144;130m"
  $blue = "${PiEsc}[38;2;77;154;191m"
  $gold = "${PiEsc}[38;2;241;190;88m"
  $turquoise = "${PiEsc}[38;2;131;204;210m"
  $bold = "${PiEsc}[1m"
  $width = 28
  $trail = 8
  $head = $Step % ($width + $trail)
  $bar = ""

  for ($i = 0; $i -lt $width; $i += 1) {
    $age = $head - $i
    if (($age -ge 0) -and ($age -lt $trail)) {
      switch ($age) {
        { $_ -in 0, 1 } { $cell = "${gold}#${reset}"; break }
        { $_ -in 2, 3 } { $cell = "${coral}#${reset}"; break }
        { $_ -in 4, 5 } { $cell = "${blue}#${reset}"; break }
        default { $cell = "${turquoise}#${reset}" }
      }
    } else {
      $cell = "${dim}-${reset}"
    }
    $bar += $cell
  }

  $line = "  ${turquoise}${Frame}${reset} $bar ${bold}${Title}${reset} $Label"
  $visibleWidth = Get-VisibleTextLength $line
  $lastWidth = [int]$script:PiLastProgressWidth
  $padWidth = [Math]::Max(0, $lastWidth - $visibleWidth)

  [Console]::Write("`r$line" + (" " * $padWidth))
  $script:PiLastProgressWidth = [Math]::Max($lastWidth, $visibleWidth)
}

function Finish-InstallProgress {
  $lastWidth = [int]$script:PiLastProgressWidth
  if ($lastWidth -gt 0) {
    [Console]::Write("`r" + (" " * $lastWidth) + "`r")
  } else {
    [Console]::Write("`r")
  }
  [Console]::Write("${PiEsc}[?25h")
  $script:PiLastProgressWidth = 0
}

function Write-StaticLogo {
  if (Test-InstallerInteractiveOutput) {
    $block = [string][char]0x2588
  } else {
    $block = "#"
  }

  Write-Host ""
  Write-Host ("  " + ($block * 6))
  Write-Host ("  " + ($block * 2) + "  " + ($block * 2))
  Write-Host ("  " + ($block * 4) + "  " + ($block * 2))
  Write-Host ("  " + ($block * 2) + "    " + ($block * 2))
  Write-Host ""
}

function Test-InCells {
  param([int]$Y, [int]$X, [string]$Cells)

  foreach ($item in ($Cells -split " ")) {
    if ($item -eq "$Y,$X") {
      return $true
    }
  }
  return $false
}

function Test-InPiece {
  param([int]$Y, [int]$X, [int]$PieceY, [int]$PieceX, [string]$Cells)

  foreach ($item in ($Cells -split " ")) {
    $parts = $item -split ","
    if (($Y -eq ($PieceY + [int]$parts[0])) -and ($X -eq ($PieceX + [int]$parts[1]))) {
      return $true
    }
  }
  return $false
}

function Get-LogoCellColor {
  param(
    [int]$Phase,
    [string]$Active,
    [int]$ActiveX,
    [int]$ActiveY,
    [int]$Flash,
    [int]$White,
    [int]$Y,
    [int]$X
  )

  if ($White -eq 1) {
    if (Test-InCells $Y $X "3,2 3,3 3,4 4,2 4,4 5,2 5,3 5,5 6,2 6,5") { return "white" }
    return "panel"
  }
  if (($Flash -eq 1) -and ($Y -eq 6) -and ($X -ge 1) -and ($X -le 6)) { return "flash" }

  if (($Active -eq "left") -and (Test-InPiece $Y $X $ActiveY $ActiveX "0,0 1,0 1,1 2,0")) { return "blue" }
  if (($Active -eq "top") -and (Test-InPiece $Y $X $ActiveY $ActiveX "0,0 0,1 0,2 1,2")) { return "coral" }
  if (($Active -eq "right") -and (Test-InPiece $Y $X $ActiveY $ActiveX "0,0 1,0 2,0 2,1")) { return "gold" }

  if ($Phase -eq 4) {
    if (Test-InCells $Y $X "2,2 2,3 2,4 3,4") { return "coral" }
    if (Test-InCells $Y $X "3,2 4,2 4,3 5,2") { return "blue" }
    if (Test-InCells $Y $X "4,5 5,5") { return "gold" }
    return "panel"
  }

  if ($Phase -ge 5) {
    if (Test-InCells $Y $X "3,2 3,3 3,4 4,4") { return "coral" }
    if (Test-InCells $Y $X "4,2 5,2 5,3 6,2") { return "blue" }
    if (Test-InCells $Y $X "5,5 6,5") { return "gold" }
    return "panel"
  }

  if (($Phase -le 3) -and (Test-InCells $Y $X "6,1 6,2 6,3 6,4")) { return "turquoise" }
  if (($Phase -ge 2) -and (Test-InCells $Y $X "2,2 2,3 2,4 3,4")) { return "coral" }
  if (($Phase -ge 1) -and (Test-InCells $Y $X "3,2 4,2 4,3 5,2")) { return "blue" }
  if (($Phase -ge 3) -and (Test-InCells $Y $X "4,5 5,5 6,5 6,6")) { return "gold" }

  return "panel"
}

function Write-LogoFrame {
  param(
    [string]$Clear,
    [string]$Reset,
    [int]$Phase,
    [string]$Active,
    [int]$ActiveX,
    [int]$ActiveY,
    [int]$Flash,
    [int]$White
  )

  $blockCell = ([string][char]0x2588) * 2
  $cells = @{
    panel = "$Reset  "
    coral = "${PiEsc}[38;2;240;144;130m$blockCell"
    blue = "${PiEsc}[38;2;77;154;191m$blockCell"
    gold = "${PiEsc}[38;2;241;190;88m$blockCell"
    turquoise = "${PiEsc}[38;2;131;204;210m$blockCell"
    white = "${PiEsc}[39m$blockCell"
    flash = "${PiEsc}[38;2;255;255;255m$blockCell"
  }

  $frame = $Clear
  foreach ($y in 0..8) {
    foreach ($x in 1..8) {
      $color = Get-LogoCellColor $Phase $Active $ActiveX $ActiveY $Flash $White $y $x
      $frame += $cells[$color]
    }
    $frame += "$Reset`n"
  }
  [Console]::Write($frame)
}

function Show-PiLogoAnimation {
  if (-not (Test-InstallerAnsiOutput)) {
    Write-StaticLogo
    return
  }

  $esc = "${PiEsc}["
  $reset = "${PiEsc}[0m"
  $clear = "${esc}H"

  [Console]::Write("${esc}?25l${esc}2J${esc}H")

  foreach ($y in 0..3) { Write-LogoFrame $clear $reset 0 "left" 2 $y 0 0; Start-Sleep -Milliseconds 75 }
  foreach ($y in 0..2) { Write-LogoFrame $clear $reset 1 "top" 2 $y 0 0; Start-Sleep -Milliseconds 75 }
  foreach ($y in 0..4) { Write-LogoFrame $clear $reset 2 "right" 5 $y 0 0; Start-Sleep -Milliseconds 75 }

  Write-LogoFrame $clear $reset 3 "none" 0 0 0 0; Start-Sleep -Milliseconds 250
  Write-LogoFrame $clear $reset 3 "none" 0 0 1 0; Start-Sleep -Milliseconds 80
  Write-LogoFrame $clear $reset 3 "none" 0 0 0 0; Start-Sleep -Milliseconds 80
  Write-LogoFrame $clear $reset 3 "none" 0 0 1 0; Start-Sleep -Milliseconds 80
  Write-LogoFrame $clear $reset 4 "none" 0 0 0 0; Start-Sleep -Milliseconds 100
  Write-LogoFrame $clear $reset 5 "none" 0 0 0 0; Start-Sleep -Milliseconds 450
  Write-LogoFrame $clear $reset 5 "none" 0 0 0 1; Start-Sleep -Milliseconds 120
  Write-LogoFrame $clear $reset 5 "none" 0 0 0 0; Start-Sleep -Milliseconds 120
  Write-LogoFrame $clear $reset 5 "none" 0 0 0 1; Start-Sleep -Milliseconds 450

  [Console]::Write("$reset${esc}?25h`n")
}

function Write-OutputLines {
  param([object[]]$Lines)

  foreach ($line in $Lines) {
    Write-Host $line
  }
}

function Test-NodeVersionIsNewEnough {
  param([string]$Version)

  $normalized = $Version.TrimStart("v")
  $parsed = [version]$normalized
  return $parsed -ge $NodeMinimum
}

function Invoke-PreflightChecks {
  $status = 0

  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    $nodeVersion = (& node --version).Trim()
    if (-not (Test-NodeVersionIsNewEnough $nodeVersion)) {
      Write-Output "error: Pi requires Node.js 22.19.0 or newer. Found $nodeVersion."
      $status = 1
    }
  } else {
    Write-Output "error: Node.js 22.19.0 or newer is required to install Pi."
    $status = 1
  }

  # Prefer npm.cmd, the shim shipped with the official Node.js install. Some
  # Node managers (for example nvm for Windows setups) expose only npm.exe.
  # Plain `npm` is avoided because it can resolve to npm.ps1, which
  # Restricted/AllSigned execution policies block.
  $npm = Get-Command npm.cmd, npm.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($npm) {
    $global:NpmCommand = $npm.Source
  } else {
    Write-Output "error: npm is required to install Pi."
    $status = 1
  }

  if ($status -ne 0) {
    Write-Output ""
  }

  $script:PiPreflightStatus = $status
}

# Read user environment values directly from the registry instead of using
# [Environment]::GetEnvironmentVariable. The DoNotExpandEnvironmentNames flag keeps
# entries such as %USERPROFILE% literal so writing PATH back does not accidentally
# expand or rewrite user-managed variables.
function Get-UserEnv {
  param([string]$Key)

  $registerKey = Get-Item -Path "HKCU:"
  $envRegisterKey = $registerKey.OpenSubKey("Environment")
  $envRegisterKey.GetValue($Key, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
}

# Tell Explorer and newly launched terminals that HKCU:\Environment changed.
# Without this broadcast, PATH updates generally require signing out or restarting
# Windows before other processes notice them.
function Publish-EnvChange {
  if (-not ("Win32.NativeMethods" -as [Type])) {
    Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition @"
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(
    IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam,
    uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
"@
  }

  $hwndBroadcast = [IntPtr]0xffff
  $wmSettingChange = 0x1a
  $result = [UIntPtr]::Zero
  [Win32.NativeMethods]::SendMessageTimeout($hwndBroadcast, $wmSettingChange, [UIntPtr]::Zero, "Environment", 2, 5000, [ref]$result) | Out-Null
}

# Preserve ExpandString values when an existing variable uses percent expansion.
# This mirrors how Windows stores PATH and avoids flattening values like %APPDATA%.
function Set-UserEnv {
  param([string]$Key, [string]$Value)

  $registerKey = Get-Item -Path "HKCU:"
  $envRegisterKey = $registerKey.OpenSubKey("Environment", $true)
  if ($null -eq $Value) {
    $envRegisterKey.DeleteValue($Key)
  } else {
    $registryValueKind = if ($Value.Contains("%")) {
      [Microsoft.Win32.RegistryValueKind]::ExpandString
    } elseif ($envRegisterKey.GetValue($Key)) {
      $envRegisterKey.GetValueKind($Key)
    } else {
      [Microsoft.Win32.RegistryValueKind]::String
    }
    $envRegisterKey.SetValue($Key, $Value, $registryValueKind)
  }

  Publish-EnvChange
}

function Add-UserPathEntry {
  param([string]$Directory, [switch]$Prepend)

  # Update both the persisted user PATH and this PowerShell process. The process
  # update lets the remainder of this installer immediately find newly installed
  # node/npm/pi shims without asking the user to restart first.
  $path = (Get-UserEnv -Key "Path") -split ";" | Where-Object { $_ -and ($_ -ne $Directory) }
  if ($Prepend) {
    $path = @($Directory) + $path
  } else {
    $path += $Directory
  }
  Set-UserEnv -Key "Path" -Value ($path -join ";")

  $processPath = $env:PATH -split ";" | Where-Object { $_ -and ($_ -ne $Directory) }
  if ($Prepend) {
    $env:PATH = ((@($Directory) + $processPath) -join ";")
  } else {
    $env:PATH = (($processPath + $Directory) -join ";")
  }

  Add-PathRefreshEntry $Directory
}

function Add-PathRefreshEntry {
  param([string]$Directory)

  if (-not $script:PiPathRefreshEntries) {
    $script:PiPathRefreshEntries = @()
  }
  if ($script:PiPathRefreshEntries -notcontains $Directory) {
    $script:PiPathRefreshEntries += $Directory
  }
}

function Get-InstallerParentShell {
  $currentProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $PID"
  $parentProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($currentProcess.ParentProcessId)"
  if ($parentProcess.Name -ieq "cmd.exe") {
    return "cmd"
  }
  return "powershell"
}

function Get-PathRefreshCommand {
  param([string[]]$Directories)

  $prefix = ($Directories | Where-Object { $_ } | Select-Object -Unique) -join ";"
  if (-not $prefix) {
    return ""
  }

  if ((Get-InstallerParentShell) -eq "cmd") {
    return "set `"PATH=$prefix;%PATH%`""
  }
  return "`$env:PATH = `"$prefix;`$env:PATH`""
}

function Write-PathRefreshNote {
  if (-not $script:PiPathRefreshEntries -or $script:PiPathRefreshEntries.Count -eq 0) {
    return
  }

  $command = Get-PathRefreshCommand $script:PiPathRefreshEntries
  if (-not $command) {
    return
  }

  Write-Host ""
  Write-Host "If pi is not found in the terminal that launched this installer,"
  Write-Host "restart it or update PATH there now:"
  Write-Host ""
  Write-Host "  $command"
}

function Get-WindowsArch {
  # Use the machine environment registry value rather than process environment
  # variables so ARM64 Windows running an x64 PowerShell still resolves to arm64.
  $arch = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment").PROCESSOR_ARCHITECTURE
  if ($arch -eq "AMD64") {
    return "x64"
  }
  if ($arch -eq "ARM64") {
    return "arm64"
  }

  Write-Host "Unsupported CPU architecture for automatic dependency install: $arch"
  exit 1
}

function Invoke-DownloadFile {
  param([string]$Url, [string]$OutFile)

  # Use curl.exe explicitly: plain "curl" is an alias for Invoke-WebRequest in
  # Windows PowerShell, and curl.exe is substantially faster on older systems.
  curl.exe "-#SfLo" $OutFile $Url
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "curl.exe failed; trying Invoke-RestMethod..."
    Invoke-RestMethod -Uri $Url -OutFile $OutFile
  }
}

function Assert-NodeDownloadChecksum {
  param([string]$ShasumsPath, [string]$NodeFile, [string]$ZipPath)

  $escapedNodeFile = [regex]::Escape($NodeFile)
  $selected = Get-Content $ShasumsPath | Where-Object { $_ -match "^([a-fA-F0-9]+)\s+$escapedNodeFile$" } | Select-Object -First 1
  if (-not $selected) {
    Write-Host "No checksum was found for $NodeFile."
    exit 1
  }

  $expectedHash = ([regex]::Match($selected, "^([a-fA-F0-9]+)")).Groups[1].Value.ToLowerInvariant()
  $actualHash = (Get-FileHash $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $expectedHash) {
    Write-Host "Node.js download checksum verification failed."
    Write-Host "Expected: $expectedHash"
    Write-Host "Actual:   $actualHash"
    exit 1
  }
}

function Install-NodeStandalone {
  $nodeArch = Get-WindowsArch
  $nodeDistBase = "https://nodejs.org/dist/latest-v22.x"
  # Keep the auto-installed Node.js separate from the user's normal Node setup.
  # npm itself still installs Pi globally according to npm's configured prefix.
  $nodeBaseDir = Join-Path $env:LOCALAPPDATA "pi-node"
  $nodeTmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "pi-node-$PID"

  Remove-Item $nodeTmpDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $nodeTmpDir, $nodeBaseDir | Out-Null

  $shasumsPath = Join-Path $nodeTmpDir "SHASUMS256.txt"
  Write-Host "Resolving Node.js binary for win-$nodeArch"
  Invoke-DownloadFile "$nodeDistBase/SHASUMS256.txt" $shasumsPath

  $nodeFile = Get-Content $shasumsPath | ForEach-Object {
    if ($_ -match "\s+(node-v.+-win-$nodeArch\.zip)$") { $Matches[1] }
  } | Select-Object -First 1

  if (-not $nodeFile) {
    Write-Host "No Node.js binary is available for win-$nodeArch."
    exit 1
  }

  $zipPath = Join-Path $nodeTmpDir $nodeFile
  Write-Host "Downloading Node.js $($nodeFile -replace '\.zip$', '')"
  Invoke-DownloadFile "$nodeDistBase/$nodeFile" $zipPath
  Write-Host "Verifying Node.js download"
  Assert-NodeDownloadChecksum $shasumsPath $nodeFile $zipPath

  Write-Host "Extracting Node.js to $nodeBaseDir"
  # Windows 10 1803+ ships bsdtar as System32\tar.exe. It unpacks Node's ~2,000 files in about a second, while
  # Windows PowerShell 5.1's Expand-Archive runs script code for every entry and takes over 20 seconds. Call it by
  # full path: a Git for Windows tar.exe earlier on PATH is GNU tar, which cannot read zip files.
  $systemTar = Join-Path $env:SystemRoot "System32\tar.exe"
  if (Test-Path $systemTar -PathType Leaf) {
    & $systemTar -xf $zipPath -C $nodeTmpDir
    if ($LASTEXITCODE -ne 0) {
      Write-Host "Node.js extraction failed."
      exit $LASTEXITCODE
    }
  } else {
    Expand-Archive $zipPath $nodeTmpDir -Force
  }

  $extractedDir = Join-Path $nodeTmpDir ($nodeFile -replace "\.zip$", "")
  $currentDir = Join-Path $nodeBaseDir "current"
  Remove-Item $currentDir -Recurse -Force -ErrorAction SilentlyContinue
  Move-Item $extractedDir $currentDir -Force
  Remove-Item $nodeTmpDir -Recurse -Force

  Add-UserPathEntry $currentDir -Prepend
  Write-Host "Node.js installed at $currentDir"
}

function Read-NodeNpmInstallChoice {
  if (-not (Test-InstallerInteractiveInput)) {
    Write-Host "No terminal detected; install Node.js 22.19.0 or newer and npm, then run this installer again."
    return $false
  }

  $answer = Read-Host "Pi needs Node.js 22.19.0 or newer and npm. Install standalone Node.js now? [Y/n]"
  if ($answer -match "^(n|no)$") {
    Write-Host ""
    Write-Host "Will skip Node.js install."
    return $false
  }

  return $true
}

function Get-PiAgentDir {
  return Join-Path ([Environment]::GetFolderPath("UserProfile")) ".pi\agent"
}

function Test-PiManagedInstallEnabled {
  return $env:PI_LEGACY_INSTALL -ne "1"
}

function Get-PiManagedDefaultAgentDir {
  if ($env:PI_CODING_AGENT_DIR) {
    return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($env:PI_CODING_AGENT_DIR)
  }
  return Get-PiAgentDir
}

function Get-PiSettingsPath {
  return Join-Path (Get-PiAgentDir) "settings.json"
}

function Get-PiManagedGitBashDir {
  return Join-Path (Get-PiAgentDir) "win-git-bash"
}

function Get-PiManagedGitBashPath {
  return Join-Path (Join-Path (Get-PiManagedGitBashDir) "bin") "bash.exe"
}

function Get-PiSettingsShellPath {
  $settingsPath = Get-PiSettingsPath
  if (-not (Test-Path $settingsPath -PathType Leaf)) {
    return ""
  }

  $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
  if ($settings -and ($settings.PSObject.Properties.Name -contains "shellPath")) {
    return [string]$settings.shellPath
  }
  return ""
}

function Set-PiSettingsShellPath {
  param([string]$ShellPath)

  $settingsPath = Get-PiSettingsPath
  New-Item -ItemType Directory -Force -Path (Split-Path $settingsPath -Parent) | Out-Null

  if (Test-Path $settingsPath -PathType Leaf) {
    $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
  } else {
    $settings = [PSCustomObject]@{}
  }
  if ($null -eq $settings) {
    $settings = [PSCustomObject]@{}
  }

  $settings | Add-Member -MemberType NoteProperty -Name "shellPath" -Value $ShellPath -Force
  $json = $settings | ConvertTo-Json -Depth 100
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($settingsPath, "$json`r`n", $utf8NoBom)
}

function Find-BashOnPath {
  $command = Get-Command bash.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command -and $command.Source -and (Test-Path $command.Source -PathType Leaf)) {
    return $command.Source
  }
  return ""
}

function Find-GitBashInKnownLocations {
  $paths = @()
  if ($env:ProgramFiles) {
    $paths += Join-Path (Join-Path $env:ProgramFiles "Git") "bin\bash.exe"
  }
  $programFilesX86 = ${env:ProgramFiles(x86)}
  if ($programFilesX86) {
    $paths += Join-Path (Join-Path $programFilesX86 "Git") "bin\bash.exe"
  }

  foreach ($path in $paths) {
    if (Test-Path $path -PathType Leaf) {
      return $path
    }
  }

  return Find-BashOnPath
}

function Find-ExistingBashForPi {
  $configuredShellPath = Get-PiSettingsShellPath
  if ($configuredShellPath) {
    if (Test-Path $configuredShellPath -PathType Leaf) {
      return $configuredShellPath
    }
    return ""
  }

  return Find-GitBashInKnownLocations
}

function Test-WingetAvailable {
  return [bool](Get-Command winget.exe -ErrorAction SilentlyContinue)
}

function Read-GitBashInstallChoice {
  if (-not (Test-InstallerInteractiveInput)) {
    Write-Host "No terminal detected; skipping optional Git Bash install. Install Git for Windows or set shellPath in settings.json for Pi bash commands."
    return "none"
  }

  $gitDir = Get-PiManagedGitBashDir
  $wingetAvailable = Test-WingetAvailable

  Write-Host "Pi needs Git Bash for bash commands."
  Write-Host ""
  Write-Host "Choose Git Bash install method:"
  Write-Host ""
  Write-Host "  y     Install managed Portable Git under $gitDir (default)"
  if ($wingetAvailable) {
    Write-Host "  w     Install Git for Windows globally with winget"
  }
  Write-Host "  n     Skip Git Bash"
  Write-Host ""

  while ($true) {
    $prompt = if ($wingetAvailable) { "Choice [Y/w/n]" } else { "Choice [Y/n]" }
    $answer = Read-Host $prompt
    if (-not $answer -or $answer -match "^(y|yes)$") {
      return "portable"
    }
    if ($wingetAvailable -and ($answer -match "^(w|winget)$")) {
      return "winget"
    }
    if ($answer -match "^(n|no)$") {
      Write-Host ""
      Write-Host "Will skip Git Bash install."
      return "none"
    }

    Write-Host "Please choose one of the listed keys."
  }
}

function Get-PortableGitAsset {
  $gitArch = Get-WindowsArch
  $assetSuffix = if ($gitArch -eq "arm64") { "arm64.7z.exe" } else { "64-bit.7z.exe" }

  Write-Host "Resolving Portable Git for win-$gitArch"
  $release = Invoke-RestMethod -Uri $GitForWindowsLatestReleaseApi -Headers @{ "User-Agent" = "pi-installer" }
  $asset = $release.assets | Where-Object { $_.name -like "PortableGit-*$assetSuffix" } | Select-Object -First 1
  if (-not $asset) {
    Write-Host "No Portable Git binary is available for win-$gitArch."
    exit 1
  }

  $escapedAssetName = [regex]::Escape($asset.name)
  $checksumMatch = [regex]::Match($release.body, "(?m)^$escapedAssetName\s+\|\s+([a-fA-F0-9]{64})\s*$")
  if (-not $checksumMatch.Success) {
    Write-Host "No checksum was found for $($asset.name)."
    exit 1
  }

  return [PSCustomObject]@{
    Name = $asset.name
    Url = $asset.browser_download_url
    Sha256 = $checksumMatch.Groups[1].Value.ToLowerInvariant()
  }
}

function Assert-PortableGitDownloadChecksum {
  param([string]$ExpectedHash, [string]$PortableGitPath)

  $actualHash = (Get-FileHash $PortableGitPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $ExpectedHash) {
    Write-Host "Portable Git download checksum verification failed."
    Write-Host "Expected: $ExpectedHash"
    Write-Host "Actual:   $actualHash"
    exit 1
  }
}

function Install-GitBashWithWinget {
  if (-not (Test-WingetAvailable)) {
    Write-Host "winget.exe was not found."
    exit 1
  }

  Write-Host "Installing Git for Windows globally with winget"
  Write-Host ""
  Write-Host "  winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements"
  Write-Host ""

  & winget.exe install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  $installedBash = Find-GitBashInKnownLocations
  if ($installedBash) {
    $configuredShellPath = Get-PiSettingsShellPath
    if ($configuredShellPath -and (-not (Test-Path $configuredShellPath -PathType Leaf))) {
      Set-PiSettingsShellPath $installedBash
      Write-Host "Pi shellPath set to $installedBash"
    }
    Write-Host "Git Bash installed at $installedBash"
  } else {
    Write-Host "Git for Windows was installed, but Pi cannot find bash in this terminal yet."
    Write-Host "Restart your shell before using Pi bash commands."
  }
}

function Install-GitBashStandalone {
  $gitDir = Get-PiManagedGitBashDir
  $gitBashPath = Get-PiManagedGitBashPath
  if (Test-Path $gitBashPath -PathType Leaf) {
    Set-PiSettingsShellPath $gitBashPath
    Write-Host "Git Bash configured at $gitBashPath"
    return
  }

  $gitTmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "pi-git-bash-$PID"
  $gitExtractDir = Join-Path $gitTmpDir "extract"

  Remove-Item $gitTmpDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $gitTmpDir, $gitExtractDir, (Get-PiAgentDir) | Out-Null

  $asset = Get-PortableGitAsset
  $portableGitPath = Join-Path $gitTmpDir $asset.Name
  Write-Host "Downloading Portable Git $($asset.Name -replace '^PortableGit-', '' -replace '\.7z\.exe$', '')"
  Invoke-DownloadFile $asset.Url $portableGitPath
  Write-Host "Verifying Portable Git download"
  Assert-PortableGitDownloadChecksum $asset.Sha256 $portableGitPath

  Write-Host "Extracting Portable Git to $gitDir"
  $extractProcess = Start-Process -FilePath $portableGitPath -ArgumentList @("-y", "-o`"$gitExtractDir`"") -PassThru -Wait -WindowStyle Hidden
  if ($extractProcess.ExitCode -ne 0) {
    Write-Host "Portable Git extraction failed."
    exit $extractProcess.ExitCode
  }

  $extractedBashPath = Join-Path (Join-Path $gitExtractDir "bin") "bash.exe"
  if (-not (Test-Path $extractedBashPath -PathType Leaf)) {
    Write-Host "Portable Git extraction did not produce bin\bash.exe."
    exit 1
  }

  Remove-Item $gitDir -Recurse -Force -ErrorAction SilentlyContinue
  Move-Item $gitExtractDir $gitDir -Force
  Remove-Item $gitTmpDir -Recurse -Force

  Set-PiSettingsShellPath $gitBashPath
  Write-Host "Git Bash installed at $gitDir"
  Write-Host "Pi shellPath set to $gitBashPath"
}

function Get-NpmGlobalPrefix {
  # Windows PowerShell promotes redirected native stderr to error records, so an
  # npm warning would abort under Stop. This assignment is local to the function.
  $ErrorActionPreference = "Continue"
  $previousOutputEncoding = [Console]::OutputEncoding
  try {
    # npm writes UTF-8 to redirected stdout. Decode it explicitly instead of
    # using the console's OEM code page, which corrupts non-ASCII paths.
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $prefix = (& $global:NpmCommand prefix -g 2>$null).Trim()
    if ($prefix) {
      return $prefix
    }

    return (& $global:NpmCommand config get prefix 2>$null).Trim()
  } finally {
    [Console]::OutputEncoding = $previousOutputEncoding
  }
}

function Test-PathWritableOrCreatable {
  param([string]$Path)

  $checkPath = $Path
  while (-not (Test-Path $checkPath)) {
    $parent = Split-Path $checkPath -Parent
    if (-not $parent -or $parent -eq $checkPath) {
      return $false
    }
    $checkPath = $parent
  }

  if (-not (Test-Path $checkPath -PathType Container)) {
    return $false
  }

  $probe = Join-Path $checkPath ".pi-write-test-$PID"
  try {
    New-Item -ItemType File -Path $probe -Force | Out-Null
    Remove-Item $probe -Force
    return $true
  } catch {
    # Windows PowerShell raises the preference-promoted error through
    # ActionPreferenceStopException, so typed catch clauses do not match it.
    if (($_.Exception -is [System.UnauthorizedAccessException]) -or ($_.Exception.InnerException -is [System.UnauthorizedAccessException])) {
      return $false
    }
    throw
  }
}

function Test-NpmPrefixSupportsGlobalInstall {
  param([string]$Prefix)

  return (Test-PathWritableOrCreatable (Join-Path $Prefix "node_modules")) -and (Test-PathWritableOrCreatable $Prefix)
}

function Get-PiBinDir {
  if ((Test-PiManagedInstallEnabled) -and $env:PI_MANAGED_BIN_DIR) {
    return $env:PI_MANAGED_BIN_DIR
  }
  if ($env:PI_NPM_INSTALL_PREFIX) {
    return $env:PI_NPM_INSTALL_PREFIX
  }

  return Get-NpmGlobalPrefix
}

function Get-PiInstalledPaths {
  $binDir = Get-PiBinDir
  if ($binDir) {
    return @((Join-Path $binDir "pi.cmd"), (Join-Path $binDir "pi.ps1"), (Join-Path $binDir "pi"))
  }

  return @()
}

function Remove-BlockedPiPowerShellShim {
  $executionPolicy = Get-ExecutionPolicy
  if ($executionPolicy -notin @("Restricted", "AllSigned")) {
    return
  }

  # npm creates both pi.cmd and pi.ps1, and PowerShell resolves the .ps1 shim
  # first. Under these policies that makes `pi` fail even though pi.cmd is
  # allowed, so remove only the blocked shim instead of weakening the user's
  # execution policy.
  $binDir = Get-PiBinDir
  $cmdShim = Join-Path $binDir "pi.cmd"
  $powerShellShim = Join-Path $binDir "pi.ps1"
  if ((Test-Path $cmdShim -PathType Leaf) -and (Test-Path $powerShellShim -PathType Leaf)) {
    Remove-Item $powerShellShim -Force
    Write-Host "  ok configured Pi for PowerShell's $executionPolicy execution policy"
  }
}

function Select-NpmInstallPrefix {
  $npmPrefix = Get-NpmGlobalPrefix
  if ($npmPrefix -and (Test-NpmPrefixSupportsGlobalInstall $npmPrefix)) {
    return ""
  }

  # If an existing global pi is present but npm's prefix is not writable, do not
  # install a second copy elsewhere: PATH would likely continue resolving to the
  # old shim, making the successful install look broken.
  $existingGlobalPi = @((Join-Path $npmPrefix "pi.cmd"), (Join-Path $npmPrefix "pi.ps1")) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($npmPrefix -and $existingGlobalPi) {
    Write-Host "npm's global directory is not writable: $npmPrefix"
    Write-Host "Pi is already installed at: $existingGlobalPi"
    Write-Host ""
    Write-Host "Installing another copy under your profile could leave your shell using the old global pi, so this installer stopped."
    exit 1
  }

  $userPrefix = Join-Path $env:APPDATA "npm"
  New-Item -ItemType Directory -Force -Path $userPrefix | Out-Null
  return $userPrefix
}

function Select-NpmUninstallPrefix {
  param([string]$ExistingPiPath)

  # On Windows npm creates command shims directly in the prefix directory
  # (pi.cmd / pi.ps1), unlike Unix where shims live under prefix/bin.
  if (-not $ExistingPiPath) {
    return ""
  }

  $npmPrefix = Get-NpmGlobalPrefix
  if ($npmPrefix -and (($ExistingPiPath -eq (Join-Path $npmPrefix "pi.cmd")) -or ($ExistingPiPath -eq (Join-Path $npmPrefix "pi.ps1")))) {
    return ""
  }

  if ($env:PI_NPM_INSTALL_PREFIX -and (($ExistingPiPath -eq (Join-Path $env:PI_NPM_INSTALL_PREFIX "pi.cmd")) -or ($ExistingPiPath -eq (Join-Path $env:PI_NPM_INSTALL_PREFIX "pi.ps1")))) {
    return $env:PI_NPM_INSTALL_PREFIX
  }

  $fileName = Split-Path $ExistingPiPath -Leaf
  if ($fileName -in @("pi.cmd", "pi.ps1", "pi")) {
    return (Split-Path $ExistingPiPath -Parent)
  }

  return ""
}

function Get-PiManagedInstallMarkerPath {
  param([string]$ManagedRoot)

  return Join-Path $ManagedRoot $PiManagedInstallMarker
}

function Test-PiManagedInstallMarker {
  param([string]$ManagedRoot)

  if (-not $ManagedRoot) {
    return $false
  }
  $markerPath = Get-PiManagedInstallMarkerPath $ManagedRoot
  if (-not (Test-Path $markerPath -PathType Leaf)) {
    return $false
  }

  $markerScript = @'
const fs = require("node:fs");
const marker = JSON.parse(fs.readFileSync(process.argv[2], "utf8").replace(/^\uFEFF/, ""));
if (
	marker.kind !== "pi-managed-install" ||
	marker.schemaVersion !== 1 ||
	marker.layout !== "releases-v1"
) {
	process.exit(1);
}
'@
  # Windows PowerShell promotes redirected native stderr to error records, so a
  # Node warning or an invalid marker would abort under Stop.
  $ErrorActionPreference = "Continue"
  $markerScript | & node - $markerPath *> $null
  return $LASTEXITCODE -eq 0
}

function Get-PiManagedInstallRootForCommand {
  param([string]$CommandPath)

  if (-not $CommandPath) {
    return ""
  }
  $fileName = Split-Path $CommandPath -Leaf
  if ($fileName -notin @("pi", "pi.cmd", "pi.ps1")) {
    return ""
  }

  $binDir = Split-Path ([System.IO.Path]::GetFullPath($CommandPath)) -Parent
  $agentDir = Split-Path $binDir -Parent
  $managedRoot = Join-Path $agentDir "install"
  if (Test-PiManagedInstallMarker $managedRoot) {
    return $managedRoot
  }
  return ""
}

function Select-PiManagedInstallDir {
  param([string]$ExistingPiPath)

  if ($env:PI_MANAGED_INSTALL_ROOT) {
    $managedRoot = [System.IO.Path]::GetFullPath($env:PI_MANAGED_INSTALL_ROOT)
    if (Test-PiManagedInstallMarker $managedRoot) {
      return $managedRoot
    }
  }

  $managedRoot = Get-PiManagedInstallRootForCommand $ExistingPiPath
  if ($managedRoot) {
    return $managedRoot
  }

  return Join-Path (Get-PiManagedDefaultAgentDir) "install"
}

function Get-NpmCommandName {
  return Split-Path $global:NpmCommand -Leaf
}

function Get-NpmUninstallPiCommand {
  if ($env:PI_NPM_UNINSTALL_PREFIX) {
    return "$(Get-NpmCommandName) uninstall -g --prefix `"$env:PI_NPM_UNINSTALL_PREFIX`" $PiPackage"
  }
  return "$(Get-NpmCommandName) uninstall -g $PiPackage"
}

function Write-PiInstallCommand {
  if ($env:PI_LEGACY_NPM_MIGRATION -eq "1") {
    $piCommand = Join-Path $env:PI_MANAGED_BIN_DIR "pi.cmd"
    return "Pi will install to $piCommand, then remove the npm package:`n  $(Get-NpmUninstallPiCommand)"
  }
  if (Test-PiManagedInstallEnabled) {
    $piCommand = Join-Path $env:PI_MANAGED_BIN_DIR "pi.cmd"
    return "Pi will install to $piCommand"
  }
  if ($env:PI_NPM_INSTALL_PREFIX) {
    return "Using legacy self managed installation`n  $(Get-NpmCommandName) install -g --ignore-scripts $NpmMinReleaseAgeArg --prefix `"$env:PI_NPM_INSTALL_PREFIX`" $PiPackage"
  }
  return "Using legacy self managed installation`n  $(Get-NpmCommandName) install -g --ignore-scripts $NpmMinReleaseAgeArg $PiPackage"
}

function Write-PiActionMenu {
  param([string]$ExistingPiPath)

  $reset = ""
  $dim = ""
  $bold = ""
  $cyan = ""
  $green = ""
  $red = ""
  if (Test-InstallerAnsiOutput) {
    $reset = "${PiEsc}[0m"
    $dim = "${PiEsc}[2m"
    $bold = "${PiEsc}[1m"
    $cyan = "${PiEsc}[36m"
    $green = "${PiEsc}[32m"
    $red = "${PiEsc}[31m"
  }

  if ($ExistingPiPath) {
    Write-Host "${bold}Pi is already installed at:${reset}"
    Write-Host ""
    Write-Host "  $ExistingPiPath"
    Write-Host ""
  }

  if ($env:PI_NPM_INSTALL_PREFIX) {
    Write-Host "npm's global directory is not writable; Pi will be installed under $env:PI_NPM_INSTALL_PREFIX."
    Write-Host ""
  }

  if ($env:PI_LEGACY_NPM_MIGRATION -eq "1") {
    Write-Host "This Pi was installed with npm. Pi now uses a managed installation"
    Write-Host "that pins all dependencies and updates itself with: pi update"
    Write-Host ""
    Write-Host "${bold}Migration:${reset}"
  } elseif (Test-PiManagedInstallEnabled) {
    if ($ExistingPiPath) {
      Write-Host "${bold}Reinstallation:${reset}"
    } else {
      Write-Host "${bold}Installation:${reset}"
    }
  } elseif ($ExistingPiPath) {
    Write-Host "${bold}Reinstall command:${reset}"
  } else {
    Write-Host "${bold}Install command:${reset}"
  }
  Write-Host ""
  Write-Host "  $(Write-PiInstallCommand)"
  Write-Host ""

  Write-Host "${bold}Choose an action:${reset}"
  Write-Host ""
  if ($env:PI_LEGACY_NPM_MIGRATION -eq "1") {
    Write-Host ("  {0}{1,-4}{2} {3}Migrate Pi to a managed installation{2} {4}(default){2}" -f $cyan, "y", $reset, $green, $dim)
    Write-Host ("  {0}{1,-4}{2} {3}Uninstall Pi{2}" -f $cyan, "u", $reset, $red)
  } elseif ($ExistingPiPath) {
    Write-Host ("  {0}{1,-4}{2} {3}Reinstall Pi{2} {4}(default){2}" -f $cyan, "y", $reset, $green, $dim)
    Write-Host ("  {0}{1,-4}{2} {3}Uninstall Pi{2}" -f $cyan, "u", $reset, $red)
  } else {
    Write-Host ("  {0}{1,-4}{2} {3}Install Pi{2} {4}(default){2}" -f $cyan, "y", $reset, $green, $dim)
  }
  Write-Host ("  {0}{1,-4}{2} {3}Do nothing{2}" -f $cyan, "n", $reset, $dim)
}

function Read-PiActionKey {
  $keyInfo = [Console]::ReadKey($true)
  if ($keyInfo.Key -eq [ConsoleKey]::Enter) {
    return ""
  }
  if ($keyInfo.Key -eq [ConsoleKey]::Spacebar) {
    return " "
  }
  if ($keyInfo.Key -eq [ConsoleKey]::Escape) {
    return $PiEsc
  }
  return [string]$keyInfo.KeyChar
}

function Get-DefaultPiAction {
  param([string]$ExistingPiPath)

  if ($env:PI_LEGACY_NPM_MIGRATION -eq "1") {
    return "migrate"
  }
  if ($ExistingPiPath) {
    return "reinstall"
  }
  return "install"
}

function Write-PiActionSelection {
  param([string]$Action)

  switch ($Action) {
    "install" { $message = "Will install Pi." }
    "reinstall" { $message = "Will reinstall Pi." }
    "migrate" { $message = "Will migrate Pi to a managed installation." }
    "uninstall" { $message = "Will uninstall Pi." }
    "none" { $message = "Chose to do nothing. Exiting." }
  }
  Write-Host ""
  Write-Host $message
  if ($Action -in @("install", "reinstall", "migrate")) {
    Write-Host "This will take a while. We're sorry."
  }
  Write-Host ""
}

function Choose-PiAction {
  param([string]$ExistingPiPath)

  Write-PiActionMenu $ExistingPiPath
  Write-Host ""

  if (-not (Test-InstallerInteractiveInput)) {
    Write-Host "No terminal detected; continuing without confirmation."
    $action = Get-DefaultPiAction $ExistingPiPath
    Write-PiActionSelection $action
    return $action
  }

  while ($true) {
    $key = Read-PiActionKey

    if (($key -eq "") -or ($key -eq " ")) {
      $action = Get-DefaultPiAction $ExistingPiPath
      break
    }
    if ($key -match "^(y|Y)$") {
      $action = Get-DefaultPiAction $ExistingPiPath
      break
    }
    if ($ExistingPiPath -and ($key -match "^(u|U)$")) {
      $action = "uninstall"
      break
    }
    if (($key -match "^(n|N)$") -or ($key -eq $PiEsc)) {
      $action = "none"
      break
    }

    Write-Host "Please choose one of the listed keys."
  }

  Write-PiActionSelection $action
  return $action
}

function Get-NpmInstallPiArgs {
  param([string]$LogLevel, [string]$Progress)

  $args = @("install", "-g", "--ignore-scripts", $NpmMinReleaseAgeArg, "--no-fund", "--no-audit", "--loglevel=$LogLevel", "--progress=$Progress")
  if ($env:PI_NPM_INSTALL_PREFIX) {
    $args += @("--prefix", $env:PI_NPM_INSTALL_PREFIX)
  }
  $args += $PiPackage
  return $args
}

function Invoke-NpmInstallPi {
  param([string]$LogLevel)

  $args = Get-NpmInstallPiArgs $LogLevel "false"
  & $global:NpmCommand @args
}

function Invoke-DownloadManagedInstallerArtifact {
  param([string]$Url, [string]$Output, [string]$Label)

  try {
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Output | Out-Null
    return $true
  } catch {
    Remove-Item $Output -Force -ErrorAction SilentlyContinue
    if ($_.Exception.Response) {
      $httpStatus = [int]$_.Exception.Response.StatusCode
      Write-Host "Managed installer $Label is unavailable at $Url (HTTP $httpStatus)."
    } else {
      Write-Host "Could not download $Label from $Url."
    }
    return $false
  }
}

function Get-PiManagedReleaseVersion {
  param([string]$MetadataPath)

  $metadataScript = @'
const fs = require("node:fs");
const metadata = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const version = metadata.version;

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
	throw new Error("managed installer metadata has an invalid version");
}
console.log(version);
'@
  # The managed install runs in a background job, where Windows PowerShell
  # promotes native stderr to error records. Rely on node's exit status.
  $ErrorActionPreference = "Continue"
  $version = $metadataScript | & node - $MetadataPath
  if ($LASTEXITCODE -ne 0) {
    return ""
  }
  return ("$version").Trim()
}

function Test-PiManagedInstallArtifacts {
  param([string]$PackageJsonPath, [string]$PackageLockPath, [string]$ManagedVersion)

  $validationScript = @'
const fs = require("node:fs");
const packageJson = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const packageLock = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const piPackage = process.argv[4];
const version = process.argv[5];
const root = packageLock.packages?.[""];
const piEntry = packageLock.packages?.[`node_modules/${piPackage}`];

if (packageJson.version !== version || packageJson.dependencies?.[piPackage] !== version) {
	throw new Error(`managed installer package.json must describe ${piPackage}@${version}`);
}
if (packageLock.lockfileVersion !== 3) {
	throw new Error("managed installer package-lock.json must use lockfileVersion 3");
}
if (packageLock.version !== version || root?.version !== version || root?.dependencies?.[piPackage] !== version) {
	throw new Error(`managed installer package-lock.json root must describe ${piPackage}@${version}`);
}
if (piEntry?.version !== version) {
	throw new Error(`managed installer package-lock.json does not include ${piPackage}@${version}`);
}
'@
  # The managed install runs in a background job, where Windows PowerShell
  # promotes native stderr to error records. Rely on node's exit status.
  $ErrorActionPreference = "Continue"
  $validationScript | & node - $PackageJsonPath $PackageLockPath $PiPackage $ManagedVersion
  return $LASTEXITCODE -eq 0
}

function Receive-PiManagedInstallArtifacts {
  param([string]$ManagedStageDir)

  $metadataPath = Join-Path $ManagedStageDir "metadata.json"
  Write-Host "Downloading managed installer release metadata"
  if (-not (Invoke-DownloadManagedInstallerArtifact "$PiInstallerApiBase/latest" $metadataPath "release metadata")) {
    return $false
  }

  $managedVersion = Get-PiManagedReleaseVersion $metadataPath
  if (-not $managedVersion) {
    Write-Host "Managed installer release metadata is invalid."
    return $false
  }

  $packageJsonPath = Join-Path $ManagedStageDir "package.json"
  Write-Host "Downloading managed installer package.json for Pi $managedVersion"
  if (-not (Invoke-DownloadManagedInstallerArtifact "$PiInstallerApiBase/$managedVersion/package.json" $packageJsonPath "package.json")) {
    return $false
  }

  $packageLockPath = Join-Path $ManagedStageDir "package-lock.json"
  Write-Host "Downloading managed installer package-lock.json for Pi $managedVersion"
  if (-not (Invoke-DownloadManagedInstallerArtifact "$PiInstallerApiBase/$managedVersion/package-lock.json" $packageLockPath "package-lock.json")) {
    return $false
  }

  if (-not (Test-PiManagedInstallArtifacts $packageJsonPath $packageLockPath $managedVersion)) {
    return $false
  }
  $global:PiManagedVersion = $managedVersion
  return $true
}

function Write-PiManagedFile {
  param([string]$Path, [string]$Content)

  $temporaryPath = "$Path.tmp.$PID"
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($temporaryPath, $Content, $utf8NoBom)
  Move-Item $temporaryPath $Path -Force
}

function Write-PiManagedInstallMarker {
  param([string]$ManagedRoot, [string]$ManagedBinDir)

  $marker = [ordered]@{
    kind = "pi-managed-install"
    schemaVersion = 1
    layout = "releases-v1"
    entrypoint = [ordered]@{
      type = "script"
      path = Join-Path $ManagedBinDir "pi.cmd"
    }
  }
  $markerJson = ($marker | ConvertTo-Json -Depth 5) + "`r`n"
  Write-PiManagedFile (Get-PiManagedInstallMarkerPath $ManagedRoot) $markerJson
}

function Write-PiManagedLaunchers {
  param([string]$ManagedAgentDir)

  $managedBinDir = Join-Path $ManagedAgentDir "bin"
  New-Item -ItemType Directory -Force -Path $managedBinDir | Out-Null

  $launcherJsPath = Join-Path $managedBinDir "pi-launcher.js"
  $shellLauncherPath = Join-Path $managedBinDir "pi"
  $cmdLauncherPath = Join-Path $managedBinDir "pi.cmd"
  $powerShellLauncherPath = Join-Path $managedBinDir "pi.ps1"
  foreach ($launcherPath in @($launcherJsPath, $shellLauncherPath, $cmdLauncherPath, $powerShellLauncherPath)) {
    if ((Test-Path $launcherPath) -and (-not (Test-Path $launcherPath -PathType Leaf))) {
      throw "Managed Pi launcher path is not a file: $launcherPath"
    }
  }

  $launcherJs = @'
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const packageName = __PI_PACKAGE__;
const commandName = __PI_COMMAND__;
const agentDir = path.dirname(__dirname);
const installRoot = path.join(agentDir, "install");
const currentFile = path.join(installRoot, "current-version");
const currentVersion = fs.readFileSync(currentFile, "utf8").trim();
if (!currentVersion || currentVersion === "." || currentVersion === ".." || !/^[0-9A-Za-z._+-]+$/.test(currentVersion)) {
	throw new Error(`Managed Pi version file is invalid: ${currentFile}`);
}

const releaseDir = path.join(installRoot, "releases", currentVersion);
const packageDir = path.join(releaseDir, "node_modules", ...packageName.split("/"));
const packageJson = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
const binPath = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.[commandName];
if (!binPath) {
	throw new Error(`${packageName} does not declare a ${commandName} bin`);
}
const cliPath = path.resolve(packageDir, binPath);
const cliRelative = path.relative(packageDir, cliPath);
if (cliRelative.startsWith("..") || path.isAbsolute(cliRelative) || !fs.statSync(cliPath).isFile()) {
	throw new Error(`Managed Pi executable is invalid: ${cliPath}`);
}

const result = spawnSync(process.execPath, [cliPath, ...process.argv.slice(2)], {
	stdio: "inherit",
	env: { ...process.env, PI_MANAGED_INSTALL_ROOT: installRoot },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
'@
  $launcherJs = $launcherJs.Replace("__PI_PACKAGE__", ($PiPackage | ConvertTo-Json -Compress))
  $launcherJs = $launcherJs.Replace("__PI_COMMAND__", ($PiCmd | ConvertTo-Json -Compress))
  # Remember whether this install used standalone Node. A new Windows shell
  # puts machine PATH first, so PATH alone cannot preserve that choice.
  $standaloneNode = Join-Path $env:LOCALAPPDATA "pi-node\current\node.exe"
  $shellNodeSetup = 'node=node'
  $cmdNodeSetup = 'SET "node=node"'
  $powerShellNodeSetup = '$node="node"'
  if ((Get-Command node).Source -eq $standaloneNode) {
    # Fall back only if the executable was removed, never on a Pi failure.
    $shellNodeSetup = @'
node='__PI_STANDALONE_NODE__'
if [ ! -f "$node" ]; then
  node=node
fi
'@
    # Normalize and shell-quote once during installation, not on every launch.
    $shellNodeSetup = $shellNodeSetup.Replace("__PI_STANDALONE_NODE__", $standaloneNode.Replace("\", "/").Replace("'", "'\''"))
    $cmdNodeSetup = @'
SET "node=node"
IF EXIST "%LOCALAPPDATA%\pi-node\current\node.exe" SET "node=%LOCALAPPDATA%\pi-node\current\node.exe"
'@
    $powerShellNodeSetup = @'
$node="node"
$standaloneNode=Join-Path $env:LOCALAPPDATA "pi-node/current/node.exe"
if (Test-Path $standaloneNode -PathType Leaf) {
  $node=$standaloneNode
}
'@
  }

  $shellLauncher = @'
#!/bin/sh
basedir=$(dirname "$(echo "$0" | sed -e 's,\\,/,g')")
__PI_NODE_SETUP__
# A successful exec replaces this shell, so Pi exit codes never run this trap.
trap 'status=$?
if [ "$status" -eq 127 ]; then
  printf "%s\n" "Pi could not find Node.js. Install Node.js 22.19.0 or newer, or rerun the installer at https://pi.dev." >&2
fi
exit "$status"' 0
exec "$node" "$basedir/pi-launcher.js" "$@"
'@
  $shellLauncher = $shellLauncher.Replace("__PI_NODE_SETUP__", $shellNodeSetup)
  $cmdLauncher = @'
@ECHO off
SETLOCAL
__PI_NODE_SETUP__
"%node%" "%~dp0pi-launcher.js" %*
SET "pi_exit_code=%ERRORLEVEL%"
IF "%pi_exit_code%"=="9009" (
  IF "%node%"=="node" (
    "%SystemRoot%\System32\where.exe" /Q node
    IF ERRORLEVEL 1 GOTO node_missing
  ) ELSE IF NOT EXIST "%node%" GOTO node_missing
)
EXIT /B %pi_exit_code%
:node_missing
ECHO Pi could not find Node.js. Install Node.js 22.19.0 or newer, or rerun the installer at https://pi.dev. 1>&2
EXIT /B %pi_exit_code%
'@
  $cmdLauncher = $cmdLauncher.Replace("__PI_NODE_SETUP__", $cmdNodeSetup)
  $powerShellLauncher = @'
#!/usr/bin/env pwsh
$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent
$launcher=Join-Path $basedir "pi-launcher.js"
__PI_NODE_SETUP__
try {
  if ($MyInvocation.ExpectingInput) {
    $input | & $node $launcher $args
  } else {
    & $node $launcher $args
  }
} catch [System.Management.Automation.CommandNotFoundException] {
  [Console]::Error.WriteLine("Pi could not find Node.js. Install Node.js 22.19.0 or newer, or rerun the installer at https://pi.dev.")
  exit 127
}
exit $LASTEXITCODE
'@
  $powerShellLauncher = $powerShellLauncher.Replace("__PI_NODE_SETUP__", $powerShellNodeSetup)

  # The caller verified ownership; rewrite launchers to repair existing installs.
  Write-PiManagedFile $launcherJsPath ($launcherJs + "`r`n")
  Write-PiManagedFile $shellLauncherPath ($shellLauncher + "`n")
  Write-PiManagedFile $cmdLauncherPath ($cmdLauncher + "`r`n")
  Write-PiManagedFile $powerShellLauncherPath ($powerShellLauncher + "`r`n")
}

function Write-PiManagedCurrentVersion {
  param([string]$ManagedRoot, [string]$ManagedVersion)

  Write-PiManagedFile (Join-Path $ManagedRoot "current-version") "$ManagedVersion`r`n"
}

function Invoke-PiManagedInstall {
  param([string]$LogLevel)

  $managedRoot = $env:PI_MANAGED_INSTALL_DIR
  $managedAgentDir = $env:PI_MANAGED_AGENT_DIR
  $markerPath = Get-PiManagedInstallMarkerPath $managedRoot

  if (($env:PI_INSTALL_ACTION -ne "migrate") -and $env:PI_EXISTING_PATH) {
    $existingRoot = Get-PiManagedInstallRootForCommand $env:PI_EXISTING_PATH
    if ((-not $existingRoot) -or ($existingRoot -ne $managedRoot)) {
      Write-Host "Managed install refused to replace Pi at $env:PI_EXISTING_PATH. Uninstall it first."
      $global:LASTEXITCODE = 1
      return
    }
  }
  if ((Test-Path $markerPath) -and (-not (Test-PiManagedInstallMarker $managedRoot))) {
    Write-Host "The managed install marker at $markerPath is invalid."
    $global:LASTEXITCODE = 1
    return
  }

  $managedBinDir = Join-Path $managedAgentDir "bin"
  $managedLauncher = Join-Path $managedBinDir "pi.cmd"
  $launcherPaths = @(
    (Join-Path $managedBinDir "pi"),
    $managedLauncher,
    (Join-Path $managedBinDir "pi.ps1"),
    (Join-Path $managedBinDir "pi-launcher.js")
  )
  if (($launcherPaths | Where-Object { Test-Path $_ } | Select-Object -First 1) -and (-not (Test-PiManagedInstallMarker $managedRoot))) {
    Write-Host "Refusing to replace the unrecognized executable at $managedLauncher."
    $global:LASTEXITCODE = 1
    return
  }

  $managedStagingRoot = Join-Path $managedRoot "staging"
  $managedReleasesRoot = Join-Path $managedRoot "releases"
  New-Item -ItemType Directory -Force -Path $managedStagingRoot, $managedReleasesRoot | Out-Null
  $managedStageDir = Join-Path $managedStagingRoot "install-$PID-$([DateTime]::UtcNow.Ticks)"
  Remove-Item $managedStageDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $managedStageDir | Out-Null

  try {
    if (-not (Receive-PiManagedInstallArtifacts $managedStageDir)) {
      $global:LASTEXITCODE = 1
      return
    }
    $managedVersion = $global:PiManagedVersion

    Write-Host "Installing managed Pi dependencies"
    $npmArgs = @("ci", "--ignore-scripts", $NpmMinReleaseAgeArg, "--omit=dev", "--include=optional", "--no-fund", "--no-audit", "--loglevel=$LogLevel", "--progress=false")
    Push-Location $managedStageDir
    # Windows PowerShell promotes redirected native stderr to error records. npm
    # writes normal verbose progress there, so rely on its checked exit status.
    $savedErrorActionPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = "Continue"
      & $global:NpmCommand @npmArgs
      $managedStatus = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $savedErrorActionPreference
      Pop-Location
    }
    if ($managedStatus -ne 0) {
      $global:LASTEXITCODE = $managedStatus
      return
    }

    $managedStagedBin = Join-Path $managedStageDir "node_modules\.bin\pi.cmd"
    if (-not (Test-Path $managedStagedBin -PathType Leaf)) {
      Write-Host "Managed Pi executable was not created by npm ci."
      $global:LASTEXITCODE = 1
      return
    }

    Write-Host "Verifying managed Pi $managedVersion"
    $savedErrorActionPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = "Continue"
      $managedInstalledVersion = & $managedStagedBin --version
      $managedStatus = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $savedErrorActionPreference
    }
    if ($managedStatus -ne 0) {
      $global:LASTEXITCODE = $managedStatus
      return
    }
    $managedInstalledVersion = ("$managedInstalledVersion").Trim()
    if ($managedInstalledVersion -ne $managedVersion) {
      Write-Host "Managed Pi smoke test returned version $managedInstalledVersion; expected $managedVersion."
      $global:LASTEXITCODE = 1
      return
    }

    $managedReleaseDir = Join-Path $managedReleasesRoot $managedVersion
    Write-Host "Activating managed Pi $managedVersion"
    if (Test-Path $managedReleaseDir -PathType Container) {
      Remove-Item $managedStageDir -Recurse -Force
    } else {
      Move-Item $managedStageDir $managedReleaseDir
    }

    # Remove the npm-installed Pi only after the managed release is verified, so
    # a failed download or npm ci leaves the existing installation working.
    if ($env:PI_INSTALL_ACTION -eq "migrate") {
      Remove-PiLegacyNpmInstall
      if ($LASTEXITCODE -ne 0) {
        return
      }
    }

    Write-PiManagedInstallMarker $managedRoot $env:PI_MANAGED_BIN_DIR
    Write-PiManagedLaunchers $managedAgentDir
    Write-PiManagedCurrentVersion $managedRoot $managedVersion
    $global:LASTEXITCODE = 0
    Write-Host "Managed Pi install complete"
  } finally {
    Remove-Item $managedStageDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-PiInstall {
  param([string]$LogLevel)

  if (Test-PiManagedInstallEnabled) {
    Invoke-PiManagedInstall $LogLevel
  } else {
    Invoke-NpmInstallPi $LogLevel
  }
}

function Install-PiPackageWithProgress {
  $logFile = Join-Path ([System.IO.Path]::GetTempPath()) "pi-installer-npm-$PID.log"
  Remove-Item $logFile -Force -ErrorAction SilentlyContinue
  New-Item -ItemType File -Path $logFile -Force | Out-Null

  $managedInstall = Test-PiManagedInstallEnabled
  if ($managedInstall) {
    $installFunctionNames = @(
      "Test-PiManagedInstallEnabled",
      "Get-NpmInstallPiArgs",
      "Invoke-NpmInstallPi",
      "Get-PiManagedInstallMarkerPath",
      "Test-PiManagedInstallMarker",
      "Get-PiManagedInstallRootForCommand",
      "Invoke-DownloadManagedInstallerArtifact",
      "Get-PiManagedReleaseVersion",
      "Test-PiManagedInstallArtifacts",
      "Receive-PiManagedInstallArtifacts",
      "Write-PiManagedFile",
      "Write-PiManagedInstallMarker",
      "Write-PiManagedLaunchers",
      "Write-PiManagedCurrentVersion",
      "Invoke-NpmUninstallPi",
      "Remove-PiLegacyNpmInstall",
      "Invoke-PiManagedInstall",
      "Invoke-PiInstall"
    )
    $workerSource = ($installFunctionNames | ForEach-Object {
      "function $_ {`n$((Get-Item "function:$_").Definition)`n}"
    }) -join "`r`n"
    $job = Start-Job -ScriptBlock {
      param(
        [string]$FunctionSource,
        [string]$Package,
        [string]$Command,
        [string]$InstallerApiBase,
        [string]$ManagedInstallMarker,
        [string]$MinReleaseAgeArg,
        [string]$Npm,
        [string]$OutputLog
      )

      $ErrorActionPreference = "Stop"
      $global:NpmCommand = $Npm
      $global:PiPackage = $Package
      $global:PiCmd = $Command
      $global:PiInstallerApiBase = $InstallerApiBase
      $global:PiManagedInstallMarker = $ManagedInstallMarker
      $global:NpmMinReleaseAgeArg = $MinReleaseAgeArg
      try {
        . ([ScriptBlock]::Create($FunctionSource))
        Invoke-PiInstall "verbose" *> $OutputLog
        $LASTEXITCODE
      } catch {
        $failureMessage = "Managed install worker failed: $($_.Exception.Message)"
        $failureMessage | Out-File -FilePath $OutputLog -Append
        1
      }
    } -ArgumentList $workerSource, $PiPackage, $PiCmd, $PiInstallerApiBase, $PiManagedInstallMarker, $NpmMinReleaseAgeArg, $global:NpmCommand, $logFile
  } else {
    $npmArgs = [System.Collections.ArrayList]::new()
    $npmArgs.AddRange([string[]](Get-NpmInstallPiArgs "verbose" "false"))
    $job = Start-Job -ScriptBlock {
      param([string]$Npm, [string[]]$ArgsForNpm, [string]$OutputLog)

      & $Npm @ArgsForNpm *> $OutputLog
      $LASTEXITCODE
    } -ArgumentList $global:NpmCommand, $npmArgs, $logFile
  }

  [Console]::Write("${PiEsc}[?25l")
  $script:PiLastProgressWidth = 0
  $step = 0
  $label = if ($managedInstall) { "starting managed install" } else { "starting npm install" }
  $lastFrame = $null
  $lastLabel = $null
  $redrawIntervalMs = 180
  while ($job.State -eq "Running") {
    $frame = Get-SpinnerFrame $step
    if (($step % 3) -eq 0) {
      $label = Get-NpmInstallProgressLabel $logFile $label
    }
    if (($frame -ne $lastFrame) -or ($label -ne $lastLabel)) {
      Write-InstallProgress $step $frame $label "Installing Pi"
      $lastFrame = $frame
      $lastLabel = $label
    }
    $step += 1
    Start-Sleep -Milliseconds $redrawIntervalMs
  }

  $jobErrors = @()
  $status = Receive-Job $job -ErrorAction SilentlyContinue -ErrorVariable +jobErrors | Select-Object -Last 1
  if (($job.State -eq "Failed") -or ($null -eq $status)) {
    $status = 1
    if ($jobErrors) {
      "Managed install worker failed: $($jobErrors[-1].Exception.Message)" | Out-File -FilePath $logFile -Append
    }
  }
  Remove-Job $job
  Finish-InstallProgress

  if ($status -ne 0) {
    [Console]::Write("${PiEsc}[31mInstallation failed.${PiEsc}[0m`n`n")
    Get-Content $logFile | ForEach-Object { Write-Host $_ }
    Remove-Item $logFile -Force -ErrorAction SilentlyContinue
    exit $status
  }

  Remove-Item $logFile -Force -ErrorAction SilentlyContinue
  if ($managedInstall) {
    Write-Host "  ok install complete"
  } else {
    Write-Host "  ok npm install complete"
  }
}

function Invoke-NpmUninstallPi {
  $args = @("uninstall", "-g", "--no-fund", "--no-audit", "--loglevel=error", "--progress=false")
  if ($env:PI_NPM_UNINSTALL_PREFIX) {
    $args += @("--prefix", $env:PI_NPM_UNINSTALL_PREFIX)
  }
  $args += $PiPackage
  # Windows PowerShell promotes redirected native stderr to error records. Rely
  # on npm's exit status instead.
  $savedErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & $global:NpmCommand @args
  } finally {
    $ErrorActionPreference = $savedErrorActionPreference
  }
}

function Remove-PiLegacyNpmInstall {
  Write-Host "Removing npm-installed Pi"
  Invoke-NpmUninstallPi
  if ($LASTEXITCODE -ne 0) {
    Write-Host "npm uninstall failed. Close any running pi processes and run this installer again."
    $global:LASTEXITCODE = 1
    return
  }
  if (Test-Path $env:PI_EXISTING_PATH) {
    Write-Host "npm uninstall finished, but pi is still present at $env:PI_EXISTING_PATH."
    $global:LASTEXITCODE = 1
    return
  }
  $global:LASTEXITCODE = 0
}

function Assert-PiLegacyNpmInstallRemovable {
  $legacyPrefix = if ($env:PI_NPM_UNINSTALL_PREFIX) { $env:PI_NPM_UNINSTALL_PREFIX } else { Get-NpmGlobalPrefix }
  if ($legacyPrefix -and (Test-NpmPrefixSupportsGlobalInstall $legacyPrefix)) {
    return
  }

  Write-Host "npm's global directory is not writable, so the npm-installed Pi at $env:PI_EXISTING_PATH cannot be removed."
  Write-Host "Remove it from an elevated terminal, then run this installer again:"
  Write-Host ""
  Write-Host "  $(Get-NpmUninstallPiCommand)"
  exit 1
}

function Test-NpmPackageInstalledForUninstall {
  $args = @("ls", "-g", "--depth=0")
  if ($env:PI_NPM_UNINSTALL_PREFIX) {
    $args += @("--prefix", $env:PI_NPM_UNINSTALL_PREFIX)
  }
  $args += $PiPackage
  $savedErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & $global:NpmCommand @args *> $null
  } finally {
    $ErrorActionPreference = $savedErrorActionPreference
  }
  return $LASTEXITCODE -eq 0
}

function Install-PiPackage {
  if (Test-InstallerAnsiOutput) {
    Install-PiPackageWithProgress
  } else {
    Write-Host "Installing Pi..."
    Write-Host ""
    Invoke-PiInstall "error"
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
  }
}

function Uninstall-PiPackage {
  $managedRoot = Get-PiManagedInstallRootForCommand $env:PI_EXISTING_PATH
  if ($managedRoot) {
    Write-Host "Uninstalling managed Pi..."
    Write-Host ""
    $managedAgentDir = Split-Path $managedRoot -Parent
    $managedBinDir = Join-Path $managedAgentDir "bin"
    Remove-Item (Join-Path $managedBinDir "pi"), (Join-Path $managedBinDir "pi.cmd"), (Join-Path $managedBinDir "pi.ps1"), (Join-Path $managedBinDir "pi-launcher.js") -Force -ErrorAction SilentlyContinue
    Remove-Item $managedRoot -Recurse -Force

    if (Test-Path $env:PI_EXISTING_PATH) {
      Write-Host ""
      Write-Host "Managed uninstall finished, but pi is still present at:"
      Write-Host ""
      Write-Host "  $env:PI_EXISTING_PATH"
      exit 1
    }
    return
  }

  if (-not (Test-NpmPackageInstalledForUninstall)) {
    Write-Host "I found pi at:"
    Write-Host ""
    Write-Host "  $env:PI_EXISTING_PATH"
    Write-Host ""
    Write-Host "but npm does not show $PiPackage installed there."
    Write-Host "Nothing was removed."
    exit 1
  }

  Write-Host "Uninstalling Pi..."
  Write-Host ""
  Invoke-NpmUninstallPi
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  if ((Test-Path $env:PI_EXISTING_PATH) -or (Test-Path $env:PI_EXISTING_PATH -PathType Leaf)) {
    Write-Host ""
    Write-Host "npm uninstall finished, but pi is still present at:"
    Write-Host ""
    Write-Host "  $env:PI_EXISTING_PATH"
    exit 1
  }
}

function Test-InstalledPiIsFirstOnPath {
  $installedPiPaths = Get-PiInstalledPaths
  if (-not $installedPiPaths) {
    return $false
  }

  $activePi = Get-Command $PiCmd -ErrorAction SilentlyContinue
  return $activePi -and ($installedPiPaths -contains $activePi.Source)
}

function Write-PiNotOnPathMessage {
  $piBinDir = Get-PiBinDir
  $activePi = Get-Command $PiCmd -ErrorAction SilentlyContinue

  Write-Host "Pi was installed, but your shell is not using that install yet."
  if ($activePi) {
    Write-Host "Your shell currently resolves pi to: $($activePi.Source)"
  }

  if ($piBinDir) {
    $answer = Read-Host "Add $piBinDir to your user PATH now? [Y/n]"
    if (-not $answer -or $answer -notmatch "^(n|no)$") {
      Add-UserPathEntry $piBinDir -Prepend
      Write-Host "Added $piBinDir to your user PATH."
    }
    Write-Host "Restart your shell, then run: pi"
  } else {
    Write-Host "Check npm's global prefix with: npm prefix -g"
    Write-Host "Then add that directory to your PATH."
  }
}

function Invoke-PiInstaller {
  if ([System.Environment]::OSVersion.Platform -ne "Win32NT") {
    Write-Host "This PowerShell installer is for Windows. On Unix, use: curl -fsSL https://pi.dev/install.sh | sh"
    exit 1
  }

  $preflightOutput = Invoke-PreflightChecks
  $preflightStatus = $script:PiPreflightStatus

  Show-PiLogoAnimation
  Write-InstallerTitle
  if ($script:PiPreflightStatus -eq 0) {
    Write-OutputLines $preflightOutput
  }

  $installNode = $false
  if ($script:PiPreflightStatus -ne 0) {
    $installNode = Read-NodeNpmInstallChoice
  }

  if ($installNode) {
    Write-Host ""
    Install-NodeStandalone
    Write-Host ""
  }

  if ($preflightStatus -ne 0) {
    $preflightOutput = Invoke-PreflightChecks
    Write-OutputLines $preflightOutput
    if ($script:PiPreflightStatus -ne 0) {
      exit $script:PiPreflightStatus
    }
  }

  $existingPi = Get-Command $PiCmd -ErrorAction SilentlyContinue
  if ($existingPi) {
    $env:PI_EXISTING_PATH = $existingPi.Source
  } else {
    $env:PI_EXISTING_PATH = ""
  }

  if (Test-PiManagedInstallEnabled) {
    $managedInstallDir = Select-PiManagedInstallDir $env:PI_EXISTING_PATH
    $env:PI_MANAGED_INSTALL_DIR = $managedInstallDir
    $env:PI_MANAGED_AGENT_DIR = Split-Path $managedInstallDir -Parent
    $env:PI_MANAGED_BIN_DIR = Join-Path $env:PI_MANAGED_AGENT_DIR "bin"
    $env:PI_NPM_INSTALL_PREFIX = ""
  } else {
    $installPrefix = Select-NpmInstallPrefix
    if ($installPrefix) {
      $env:PI_NPM_INSTALL_PREFIX = $installPrefix
    } else {
      $env:PI_NPM_INSTALL_PREFIX = ""
    }
  }

  $env:PI_LEGACY_NPM_MIGRATION = ""
  if ((Test-PiManagedInstallEnabled) -and (Get-PiManagedInstallRootForCommand $env:PI_EXISTING_PATH)) {
    $env:PI_NPM_UNINSTALL_PREFIX = ""
  } else {
    $uninstallPrefix = Select-NpmUninstallPrefix $env:PI_EXISTING_PATH
    if ($uninstallPrefix) {
      $env:PI_NPM_UNINSTALL_PREFIX = $uninstallPrefix
    } else {
      $env:PI_NPM_UNINSTALL_PREFIX = ""
    }
    if ((Test-PiManagedInstallEnabled) -and $env:PI_EXISTING_PATH -and (Test-NpmPackageInstalledForUninstall)) {
      $env:PI_LEGACY_NPM_MIGRATION = "1"
    }
  }

  $action = Choose-PiAction $env:PI_EXISTING_PATH
  $env:PI_INSTALL_ACTION = $action
  if ($action -eq "uninstall") {
    Uninstall-PiPackage
    Write-Host ""
    Write-Host "Pi was uninstalled successfully."
    exit 0
  }
  if ($action -eq "none") {
    exit 0
  }
  if ($action -eq "migrate") {
    Assert-PiLegacyNpmInstallRemovable
  }

  $existingBash = Find-ExistingBashForPi
  if (-not $existingBash) {
    $gitBashInstallMethod = Read-GitBashInstallChoice
    if ($gitBashInstallMethod -eq "portable") {
      Write-Host ""
      Install-GitBashStandalone
      Write-Host ""
    } elseif ($gitBashInstallMethod -eq "winget") {
      Write-Host ""
      Install-GitBashWithWinget
      Write-Host ""
    }
  }

  Install-PiPackage
  Remove-BlockedPiPowerShellShim
  Write-Host ""
  if ($action -eq "migrate") {
    Write-Host "Pi was migrated to a managed installation successfully."
  } elseif ($action -eq "reinstall") {
    Write-Host "Pi was reinstalled successfully."
  } else {
    Write-Host "Pi was installed successfully."
  }
  if (Test-PiManagedInstallEnabled) {
    Write-Host ""
    Write-Host "Update Pi later with: pi update"
  }

  if (Test-InstalledPiIsFirstOnPath) {
    Write-Host ""
    Write-Host "Run it with: pi"
  } else {
    Write-Host ""
    Write-PiNotOnPathMessage
  }

  Write-PathRefreshNote
}

Invoke-PiInstaller
