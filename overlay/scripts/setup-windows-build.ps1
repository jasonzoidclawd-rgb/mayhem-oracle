param(
  [switch]$InstallMissing
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($PSVersionTable.PSEdition -eq "Core" -and -not $IsWindows) {
  throw "This setup script must run on Windows."
}
if (-not [Environment]::Is64BitOperatingSystem) {
  throw "A 64-bit Windows host is required."
}

$missing = [System.Collections.Generic.List[string]]::new()

function Refresh-ProcessPath {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Find-Executable {
  param([Parameter(Mandatory)][string]$Name)
  return Get-Command $Name -ErrorAction SilentlyContinue
}

function Install-Package {
  param(
    [Parameter(Mandatory)][string]$WingetId,
    [Parameter(Mandatory)][string]$ChocolateyId,
    [string[]]$WingetOverride = @()
  )

  if (-not $InstallMissing) {
    return $false
  }

  if (Find-Executable "winget.exe") {
    $arguments = @(
      "install",
      "--id", $WingetId,
      "--exact",
      "--accept-package-agreements",
      "--accept-source-agreements",
      "--silent"
    )
    if ($WingetOverride.Count -gt 0) {
      $arguments += @("--override", ($WingetOverride -join " "))
    }
    & winget.exe @arguments
    if ($LASTEXITCODE -ne 0) {
      throw "winget failed installing $WingetId (exit $LASTEXITCODE)"
    }
    Refresh-ProcessPath
    return $true
  }

  if (Find-Executable "choco.exe") {
    & choco.exe install $ChocolateyId -y --no-progress
    if ($LASTEXITCODE -ne 0) {
      throw "Chocolatey failed installing $ChocolateyId (exit $LASTEXITCODE)"
    }
    Refresh-ProcessPath
    return $true
  }

  throw "Neither winget nor Chocolatey is available to install $WingetId."
}

function Require-Command {
  param(
    [Parameter(Mandatory)][string]$Command,
    [Parameter(Mandatory)][string]$Label,
    [Parameter(Mandatory)][string]$WingetId,
    [Parameter(Mandatory)][string]$ChocolateyId
  )

  if (-not (Find-Executable $Command)) {
    [void](Install-Package -WingetId $WingetId -ChocolateyId $ChocolateyId)
  }
  if (-not (Find-Executable $Command)) {
    $missing.Add("$Label ($Command)")
    Write-Host "[MISSING] $Label"
    return $false
  }
  Write-Host "[OK] $Label"
  return $true
}

function Find-VsWhere {
  $candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"),
    (Join-Path $env:ProgramFiles "Microsoft Visual Studio\Installer\vswhere.exe")
  )
  return $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

function Import-VsDevEnvironment {
  param([Parameter(Mandatory)][string]$InstallationPath)
  $vsDevCmd = Join-Path $InstallationPath "Common7\Tools\VsDevCmd.bat"
  if (-not (Test-Path $vsDevCmd)) {
    return $false
  }
  $lines = & cmd.exe /s /c "`"$vsDevCmd`" -no_logo -arch=x64 -host_arch=x64 && set"
  if ($LASTEXITCODE -ne 0) {
    return $false
  }
  foreach ($line in $lines) {
    if ($line -match "^([^=]+)=(.*)$") {
      Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2]
    }
  }
  return $true
}

Write-Host "Windows build dependency audit"
Write-Host "OS: $([Environment]::OSVersion.VersionString)"
Write-Host "Architecture: $env:PROCESSOR_ARCHITECTURE"
Write-Host "PowerShell: $($PSVersionTable.PSVersion)"

if ($PSVersionTable.PSVersion -lt [Version]"5.1") {
  $missing.Add("PowerShell 5.1 or newer")
}

if (Require-Command -Command "git.exe" -Label "Git for Windows" -WingetId "Git.Git" -ChocolateyId "git") {
  & git.exe --version
}

$nodeOk = Require-Command -Command "node.exe" -Label "Node.js" -WingetId "OpenJS.NodeJS.22" -ChocolateyId "nodejs-lts"
if ($nodeOk) {
  $nodeVersion = (& node.exe --version).Trim()
  Write-Host "Node: $nodeVersion"
  $nodeMajor = [int]($nodeVersion.TrimStart("v").Split(".")[0])
  if ($nodeMajor -ne 22) {
    $missing.Add("Node.js 22 LTS (found $nodeVersion)")
  }
}
if (Find-Executable "npm.cmd") {
  Write-Host "npm: $((& npm.cmd --version).Trim())"
} else {
  $missing.Add("npm")
}

if (-not (Find-Executable "rustup.exe")) {
  [void](Install-Package -WingetId "Rustlang.Rustup" -ChocolateyId "rustup.install")
}
if (Find-Executable "rustup.exe") {
  if ($InstallMissing) {
    & rustup.exe toolchain install stable-x86_64-pc-windows-msvc --profile minimal
    if ($LASTEXITCODE -ne 0) { throw "rustup toolchain installation failed" }
    & rustup.exe default stable-x86_64-pc-windows-msvc
    if ($LASTEXITCODE -ne 0) { throw "rustup default configuration failed" }
    & rustup.exe target add x86_64-pc-windows-msvc --toolchain stable-x86_64-pc-windows-msvc
    if ($LASTEXITCODE -ne 0) { throw "rustup target installation failed" }
    & rustup.exe component add clippy rustfmt --toolchain stable-x86_64-pc-windows-msvc
    if ($LASTEXITCODE -ne 0) { throw "rustup component installation failed" }
  }
  $toolchains = & rustup.exe toolchain list
  if (-not ($toolchains -match "stable-x86_64-pc-windows-msvc")) {
    $missing.Add("Rust stable MSVC toolchain")
  }
  $targets = & rustup.exe target list --installed --toolchain stable-x86_64-pc-windows-msvc
  if (-not ($targets -contains "x86_64-pc-windows-msvc")) {
    $missing.Add("Rust x86_64-pc-windows-msvc target")
  }
  & rustc.exe --version
  & cargo.exe --version
} else {
  $missing.Add("rustup and Rust stable MSVC")
}

$vsWhere = Find-VsWhere
if (-not $vsWhere -and $InstallMissing) {
  [void](Install-Package `
    -WingetId "Microsoft.VisualStudio.2022.BuildTools" `
    -ChocolateyId "visualstudio2022buildtools" `
    -WingetOverride @(
      "--wait", "--passive", "--norestart",
      "--add", "Microsoft.VisualStudio.Workload.VCTools",
      "--includeRecommended"
    ))
  $vsWhere = Find-VsWhere
}

$vsPath = $null
if ($vsWhere) {
  $vsPath = (& $vsWhere -latest -products * `
    -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
    -property installationPath).Trim()
}
if (-not $vsPath) {
  $missing.Add("Visual Studio 2022 Build Tools with Desktop development with C++")
} elseif (-not (Import-VsDevEnvironment -InstallationPath $vsPath)) {
  $missing.Add("Visual Studio x64 developer environment")
} else {
  Write-Host "Visual Studio: $vsPath"
}

foreach ($tool in @("cl.exe", "link.exe")) {
  $command = Find-Executable $tool
  if (-not $command) {
    $missing.Add("$tool from the MSVC x64 toolchain")
  } else {
    Write-Host "$tool`: $($command.Source)"
    & $tool 2>&1 | Select-Object -First 2
  }
}

$sdkRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10"
$sdkLib = Join-Path $sdkRoot "Lib"
$sdkVersions = @()
if (Test-Path $sdkLib) {
  $sdkVersions = Get-ChildItem $sdkLib -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName "um\x64") } |
    Sort-Object Name -Descending
}
if ($sdkVersions.Count -eq 0) {
  $missing.Add("Windows 10 or Windows 11 SDK with x64 libraries")
} else {
  Write-Host "Windows SDK: $($sdkVersions[0].Name)"
}

if (Require-Command -Command "makensis.exe" -Label "NSIS" -WingetId "NSIS.NSIS" -ChocolateyId "nsis") {
  & makensis.exe /VERSION
}

$wixTools = @("candle.exe", "light.exe")
$missingWixTools = @($wixTools | Where-Object { -not (Find-Executable $_) })
if ($missingWixTools.Count -eq 0) {
  Write-Host "[OK] WiX v3 tools"
} else {
  [void](Install-Package -WingetId "WiXToolset.WiXToolset" -ChocolateyId "wixtoolset")
  Refresh-ProcessPath
  foreach ($tool in $wixTools) {
    if (-not (Find-Executable $tool)) {
      $missing.Add("WiX v3 $tool")
    }
  }
}

$webViewClientStateKeys = @(
  "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
  "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
  "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
)
$webViewKey = $webViewClientStateKeys | Where-Object {
  if (-not (Test-Path $_)) { return $false }
  $item = Get-ItemProperty $_ -ErrorAction SilentlyContinue
  $versionProperty = if ($item) { $item.PSObject.Properties["pv"] } else { $null }
  $version = if ($versionProperty) { $versionProperty.Value } else { $null }
  return $version -and $version -ne "0.0.0.0"
} | Select-Object -First 1
if ($webViewKey) {
  $webViewItem = Get-ItemProperty $webViewKey -ErrorAction SilentlyContinue
  $webViewVersion = $webViewItem.PSObject.Properties["pv"].Value
  Write-Host "WebView2 Runtime: $webViewVersion"
} else {
  Write-Warning "WebView2 Runtime is not installed on the builder. The Tauri NSIS/MSI uses offlineInstaller and must install it during clean-machine validation."
}

if ($missing.Count -gt 0) {
  Write-Error ("Missing required Windows build dependencies:`n - " + ($missing -join "`n - "))
  exit 1
}

Write-Host "Windows x64 build toolchain is ready."
