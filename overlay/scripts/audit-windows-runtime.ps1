param(
  [Parameter(Mandatory)][string]$Executable,
  [Parameter(Mandatory)][string]$DependencyReport,
  [Parameter(Mandatory)][string]$DumpbinLog
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($PSVersionTable.PSEdition -eq "Core" -and -not $IsWindows) {
  throw "The PE runtime audit must run on Windows."
}

$executablePath = (Resolve-Path $Executable).Path
$executableDirectory = Split-Path -Parent $executablePath
$dumpbin = Get-Command dumpbin.exe -ErrorAction SilentlyContinue
if (-not $dumpbin) {
  throw "dumpbin.exe is required. Run setup-windows-build.ps1 from an MSVC x64 developer environment."
}

$headers = & $dumpbin.Source /HEADERS $executablePath 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "dumpbin /HEADERS failed with exit code $LASTEXITCODE"
}
$dependents = & $dumpbin.Source /DEPENDENTS $executablePath 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "dumpbin /DEPENDENTS failed with exit code $LASTEXITCODE"
}

$logDirectory = Split-Path -Parent $DumpbinLog
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
@(
  "dumpbin /HEADERS $executablePath"
  $headers
  ""
  "dumpbin /DEPENDENTS $executablePath"
  $dependents
) | Set-Content -Path $DumpbinLog -Encoding UTF8

if (-not ($headers -match "machine \(x64\)")) {
  throw "The release executable is not an x64 PE."
}
if (-not ($headers -match "subsystem \(Windows GUI\)")) {
  throw "The release executable is not a Windows GUI subsystem binary."
}

$imports = @(
  $dependents |
    ForEach-Object {
      if ($_ -match "^\s+([A-Za-z0-9_.-]+\.dll)\s*$") {
        $Matches[1].ToUpperInvariant()
      }
    } |
    Where-Object { $_ } |
    Sort-Object -Unique
)

$dynamicVcRuntime = @(
  $imports | Where-Object {
    $_ -match "^(VCRUNTIME|MSVCP|CONCRT)[0-9_]*\.DLL$"
  }
)
if ($dynamicVcRuntime.Count -gt 0) {
  throw "Dynamic Visual C++ runtime imports violate the static CRT strategy: $($dynamicVcRuntime -join ', ')"
}

$binaryBytes = [IO.File]::ReadAllBytes($executablePath)
$binaryAscii = [Text.Encoding]::ASCII.GetString($binaryBytes)
$binaryUtf16 = [Text.Encoding]::Unicode.GetString($binaryBytes)
$forbiddenBinaryMarkers = @(
  "MAYHEM_OVERLAY_TIER_FIXTURE",
  "MAYHEM_OVERLAY_GEOMETRY_PREVIEW",
  "MAYHEM_OVERLAY_TRACE",
  "MAYHEM_OVERLAY_DATASET_CAPTURE",
  "ARAMGG PREVIEW",
  "TIER FIXTURE",
  "[aramgg-fixture]",
  "data-dev-only",
  "/Users/",
  "C:\Users\"
)
$embeddedMarkers = @(
  $forbiddenBinaryMarkers | Where-Object {
    $binaryAscii.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
    $binaryUtf16.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0
  }
)
if ($embeddedMarkers.Count -gt 0) {
  throw "Production executable contains forbidden diagnostic, fixture, or local-path markers: $($embeddedMarkers -join ', ')"
}

$systemDirectory = [Environment]::SystemDirectory
$classifications = foreach ($dependency in $imports) {
  $bundled = Join-Path $executableDirectory $dependency
  $system = Join-Path $systemDirectory $dependency
  if (Test-Path $bundled) {
    [pscustomobject]@{ Name = $dependency; Source = "application-bundled" }
  } elseif (Test-Path $system) {
    [pscustomobject]@{ Name = $dependency; Source = "Windows-provided" }
  } elseif ($dependency -match "^(API-MS-WIN-|EXT-MS-WIN-)") {
    [pscustomobject]@{ Name = $dependency; Source = "Windows API set" }
  } else {
    [pscustomobject]@{ Name = $dependency; Source = "UNRESOLVED" }
  }
}

$unresolved = @($classifications | Where-Object Source -eq "UNRESOLVED")
if ($unresolved.Count -gt 0) {
  throw "Unresolved PE imports: $($unresolved.Name -join ', ')"
}

$signature = Get-AuthenticodeSignature -FilePath $executablePath
$file = Get-Item $executablePath
$version = $file.VersionInfo.FileVersion
$sha256 = (Get-FileHash -Algorithm SHA256 -Path $executablePath).Hash.ToLowerInvariant()

$reportDirectory = Split-Path -Parent $DependencyReport
New-Item -ItemType Directory -Force -Path $reportDirectory | Out-Null
@(
  "Mayhem Oracle Windows Runtime Dependencies"
  "Generated: $([DateTimeOffset]::UtcNow.ToString('u'))"
  ""
  "Executable: $($file.Name)"
  "Architecture: x64"
  "Subsystem: Windows GUI"
  "File version: $version"
  "SHA-256: $sha256"
  "Authenticode status: $($signature.Status)"
  "Forbidden production marker audit: passed"
  ""
  "Visual C++ runtime strategy:"
  "- Rust target feature +crt-static is enabled for x86_64-pc-windows-msvc."
  "- No VCRUNTIME, MSVCP, or CONCRT dynamic imports were found."
  "- Windows Universal CRT/API-set components remain Windows-provided."
  ""
  "WebView2:"
  "- Not a static PE import; Tauri initializes the Evergreen WebView2 Runtime at runtime."
  "- NSIS/MSI bundle the official x64 Evergreen offline installer."
  ""
  "Windows OCR:"
  "- Windows.Media.Ocr is Windows-provided on Windows 10 build 10240 and newer."
  "- At least one installed OCR-capable Windows language pack is required."
  "- Language packs are not redistributed by this installer."
  ""
  "Direct PE imports:"
  ($classifications | ForEach-Object { "- $($_.Name): $($_.Source)" })
) | Set-Content -Path $DependencyReport -Encoding UTF8

Write-Host "PE runtime dependency audit passed for $($file.Name)."
