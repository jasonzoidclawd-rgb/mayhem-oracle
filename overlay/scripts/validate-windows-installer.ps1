param(
  [Parameter(Mandatory)][string]$Installer,
  [Parameter(Mandatory)][string]$OutputDirectory,
  [switch]$RequireCleanHost,
  [switch]$RequireWebView2InitiallyAbsent,
  [switch]$CaptureScreenshots
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($PSVersionTable.PSEdition -eq "Core" -and -not $IsWindows) {
  throw "Installer validation must run on Windows."
}

$installerPath = (Resolve-Path $Installer).Path
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$screenshots = Join-Path $OutputDirectory "screenshots"
if ($CaptureScreenshots) {
  New-Item -ItemType Directory -Force -Path $screenshots | Out-Null
}
$results = [System.Collections.Generic.List[string]]::new()

function Get-PropertyValue {
  param(
    [Parameter(Mandatory)]$Object,
    [Parameter(Mandatory)][string]$Name
  )
  $property = $Object.PSObject.Properties[$Name]
  if ($property) {
    return $property.Value
  }
  return $null
}

function Record {
  param([Parameter(Mandatory)][string]$Message)
  $results.Add($Message)
  Write-Host $Message
}

function Test-WebView2 {
  $keys = @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
  )
  $valid = $keys | Where-Object {
    if (-not (Test-Path $_)) { return $false }
    $item = Get-ItemProperty $_ -ErrorAction SilentlyContinue
    $version = if ($item) { Get-PropertyValue -Object $item -Name "pv" } else { $null }
    return $version -and $version -ne "0.0.0.0"
  } | Select-Object -First 1
  return [bool]$valid
}

function Save-Screen {
  param([Parameter(Mandatory)][string]$Name)
  if (-not $CaptureScreenshots) {
    return
  }
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bounds.Size)
    $bitmap.Save((Join-Path $screenshots "$Name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Find-UninstallEntry {
  $roots = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
  )
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) {
      continue
    }
    foreach ($key in Get-ChildItem $root) {
      $value = Get-ItemProperty $key.PSPath -ErrorAction SilentlyContinue
      if ($value -and (Get-PropertyValue -Object $value -Name "DisplayName") -eq "Mayhem Oracle") {
        return $value
      }
    }
  }
  return $null
}

function Find-InstalledExecutable {
  param([Parameter(Mandatory)]$UninstallEntry)
  $location = [string](Get-PropertyValue -Object $UninstallEntry -Name "InstallLocation")
  if ($location -and (Test-Path $location)) {
    $candidate = Get-ChildItem $location -File -Filter "*.exe" |
      Where-Object { $_.Name -notmatch "uninstall" } |
      Select-Object -First 1
    if ($candidate) {
      return $candidate.FullName
    }
  }
  $matches = @(Get-ChildItem $env:LOCALAPPDATA -Recurse -File -Filter "*.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "^(Mayhem Oracle|mayhem-oracle-overlay)\.exe$" })
  if ($matches.Count -ne 1) {
    throw "Expected one installed Mayhem Oracle executable; found $($matches.Count)."
  }
  return $matches[0].FullName
}

function Invoke-NsisInstall {
  $process = Start-Process -FilePath $installerPath -ArgumentList "/S" -PassThru -Wait
  if ($process.ExitCode -ne 0) {
    throw "NSIS installer failed with exit code $($process.ExitCode)"
  }
}

function Invoke-Uninstall {
  param([Parameter(Mandatory)]$Entry)
  $quietUninstall = Get-PropertyValue -Object $Entry -Name "QuietUninstallString"
  $normalUninstall = Get-PropertyValue -Object $Entry -Name "UninstallString"
  $commandLine = if ($quietUninstall) {
    [string]$quietUninstall
  } else {
    [string]$normalUninstall
  }
  if (-not $commandLine) {
    throw "The uninstall registry entry has no uninstall command."
  }

  $uninstaller = $null
  $arguments = ""
  if ($commandLine -match '^\s*"([^"]+)"\s*(.*)$') {
    $uninstaller = $Matches[1]
    $arguments = $Matches[2]
  } elseif ($commandLine -match '^\s*(.+?\.exe)\s*(.*)$') {
    $uninstaller = $Matches[1]
    $arguments = $Matches[2]
  }
  if (-not $uninstaller -or -not (Test-Path $uninstaller)) {
    throw "Could not resolve NSIS uninstaller from: $commandLine"
  }
  if ($arguments -notmatch "(^|\s)/S(\s|$)") {
    $arguments = "$arguments /S".Trim()
  }
  $process = Start-Process -FilePath $uninstaller -ArgumentList $arguments -PassThru -Wait
  if ($process.ExitCode -ne 0) {
    throw "NSIS uninstaller failed with exit code $($process.ExitCode)"
  }
}

Record "Windows installer validation"
Record "OS: $([Environment]::OSVersion.VersionString)"
Record "User: standard-user compatible current-user install"
Record "Installer: $(Split-Path -Leaf $installerPath)"

if ($RequireCleanHost) {
  $developerCommands = @("node.exe", "npm.cmd", "git.exe", "rustc.exe", "cargo.exe", "cl.exe", "link.exe")
  $present = @($developerCommands | Where-Object { Get-Command $_ -ErrorAction SilentlyContinue })
  if ($present.Count -gt 0) {
    throw "Clean-host validation found forbidden development commands: $($present -join ', ')"
  }
  if (Test-Path (Join-Path $env:ProgramFiles "Microsoft Visual Studio")) {
    throw "Clean-host validation found Visual Studio."
  }
  Record "Clean-host development-tool check: passed"
}

$webViewInitiallyPresent = Test-WebView2
Record "WebView2 initially present: $webViewInitiallyPresent"
if ($RequireWebView2InitiallyAbsent -and $webViewInitiallyPresent) {
  throw "WebView2 was required to be absent before installation."
}

if ($CaptureScreenshots) {
  $visibleInstaller = Start-Process -FilePath $installerPath -PassThru
  Start-Sleep -Seconds 4
  Save-Screen "01-installer"
  if (-not $visibleInstaller.HasExited) {
    Stop-Process -Id $visibleInstaller.Id -Force
  }
}

Invoke-NsisInstall
$entry = Find-UninstallEntry
if (-not $entry) {
  throw "Programs and Features uninstall entry was not created."
}
Record "Initial install: passed"
Record "Programs and Features entry: passed"

$installedExe = Find-InstalledExecutable -UninstallEntry $entry
if (-not $installedExe.StartsWith($env:LOCALAPPDATA, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Current-user installation is outside LOCALAPPDATA: $installedExe"
}
Record "Current-user application path: passed"

$shortcut = Get-ChildItem (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs") `
  -Recurse -File -Filter "*Mayhem*.lnk" -ErrorAction SilentlyContinue |
  Select-Object -First 1
if (-not $shortcut) {
  throw "Mayhem Oracle Start-menu shortcut was not created."
}
Record "Start-menu shortcut: passed"

if (-not (Test-WebView2)) {
  throw "WebView2 Runtime is still absent after the offline installer completed."
}
Record "WebView2 after install: present"

$application = Start-Process -FilePath $installedExe -PassThru
Start-Sleep -Seconds 8
if ($application.HasExited) {
  throw "Installed application exited during launch validation with code $($application.ExitCode)."
}
$samePathProcesses = @(Get-Process | Where-Object {
  try { $_.Path -eq $installedExe } catch { $false }
})
if ($samePathProcesses.Count -ne 1) {
  throw "Expected one overlay process; found $($samePathProcesses.Count)."
}
Record "Application launch: passed"
Record "Single overlay process: passed"
Save-Screen "02-installed-application"
$samePathProcesses | Stop-Process -Force

if ($CaptureScreenshots) {
  Start-Process control.exe -ArgumentList "appwiz.cpl"
  Start-Sleep -Seconds 5
  Save-Screen "03-programs-and-features"
}

Invoke-NsisInstall
$entry = Find-UninstallEntry
if (-not $entry) {
  throw "Same-version upgrade removed the uninstall entry."
}
Record "Same-version upgrade install: passed"

Invoke-Uninstall -Entry $entry
Start-Sleep -Seconds 2
if (Find-UninstallEntry) {
  throw "Uninstall entry remains after uninstall."
}
Record "Initial uninstall: passed"

Invoke-NsisInstall
$entry = Find-UninstallEntry
if (-not $entry) {
  throw "Reinstall did not recreate the uninstall entry."
}
Record "Reinstall: passed"

Invoke-Uninstall -Entry $entry
Start-Sleep -Seconds 2
if (Find-UninstallEntry) {
  throw "Uninstall entry remains after the final uninstall."
}
Record "Final uninstall: passed"
Save-Screen "04-uninstall-result"

$results | Set-Content -Path (Join-Path $OutputDirectory "INSTALL-VERIFICATION.txt") -Encoding UTF8
Write-Host "Windows installer validation passed."
