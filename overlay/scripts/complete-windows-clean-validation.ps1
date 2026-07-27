param(
  [Parameter(Mandatory)][string]$PreliminaryZip,
  [Parameter(Mandatory)][string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($PSVersionTable.PSEdition -eq "Core" -and -not $IsWindows) {
  throw "Clean installation validation must run on Windows."
}

$zipPath = (Resolve-Path $PreliminaryZip).Path
$validator = Join-Path $PSScriptRoot "validate-windows-installer.ps1"
if (-not (Test-Path $validator)) {
  throw "validate-windows-installer.ps1 must be beside this script."
}

$workDirectory = Join-Path $env:TEMP ("mayhem-clean-validation-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $workDirectory | Out-Null
Expand-Archive -Path $zipPath -DestinationPath $workDirectory -Force

$artifactRoot = Join-Path $workDirectory "artifacts"
if (-not (Test-Path $artifactRoot)) {
  throw "The preliminary ZIP does not contain artifacts/."
}
$installer = Get-ChildItem $artifactRoot -File -Filter "*_x64-setup.exe"
if (@($installer).Count -ne 1) {
  throw "Expected one x64 NSIS installer in artifacts/."
}

$checksums = Join-Path $artifactRoot "SHA256SUMS.txt"
foreach ($line in Get-Content $checksums) {
  if ($line -notmatch "^([a-fA-F0-9]{64})\s{2}(.+)$") {
    throw "Invalid SHA256SUMS.txt line: $line"
  }
  $artifact = Join-Path $artifactRoot $Matches[2]
  if (-not (Test-Path $artifact)) {
    throw "Checksummed artifact is missing: $($Matches[2])"
  }
  $actual = (Get-FileHash -Algorithm SHA256 $artifact).Hash
  if ($actual -ne $Matches[1]) {
    throw "Checksum mismatch before clean validation: $($Matches[2])"
  }
}

$cleanEvidence = Join-Path $workDirectory "clean-machine-evidence"
& $validator `
  -Installer $installer.FullName `
  -OutputDirectory $cleanEvidence `
  -RequireCleanHost `
  -RequireWebView2InitiallyAbsent `
  -CaptureScreenshots
if (-not $?) {
  throw "Clean-machine installer validation failed."
}

$requiredScreenshots = @(
  "01-installer.png",
  "02-installed-application.png",
  "03-programs-and-features.png",
  "04-uninstall-result.png"
)
foreach ($name in $requiredScreenshots) {
  $screenshot = Join-Path $cleanEvidence "screenshots\$name"
  if (-not (Test-Path $screenshot)) {
    throw "Required clean-machine screenshot is missing: $name"
  }
  if ((Get-Item $screenshot).Length -lt 1024) {
    throw "Clean-machine screenshot is unexpectedly small: $name"
  }
}

$evidenceDestination = Join-Path $artifactRoot "logs\clean-machine"
New-Item -ItemType Directory -Force -Path $evidenceDestination | Out-Null
Copy-Item (Join-Path $cleanEvidence "*") $evidenceDestination -Recurse -Force

$verificationPath = Join-Path $artifactRoot "VERIFICATION.txt"
$verification = Get-Content $verificationPath |
  Where-Object { $_ -ne "Clean Windows VM validation: NOT RUN; final delivery is blocked until this passes" }
$verification += "Clean Windows VM validation: passed"
$verification += "WebView2 initially absent and installed from bundled offline installer: passed"
$verification += "Clean install, launch, same-version upgrade, uninstall, reinstall, final uninstall: passed"
$verification | Set-Content -Path $verificationPath -Encoding UTF8

$manifestPath = Join-Path $artifactRoot "BUILD-MANIFEST.txt"
$sourceCommitLine = Get-Content $manifestPath |
  Where-Object { $_ -match "^Source commit: [a-fA-F0-9]{40}$" } |
  Select-Object -First 1
if (-not $sourceCommitLine) {
  throw "BUILD-MANIFEST.txt has no valid source commit."
}
$sourceCommit = ($sourceCommitLine -split ": ", 2)[1]
$shortCommit = $sourceCommit.Substring(0, 12)

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$finalZip = Join-Path $OutputDirectory "mayhem-windows-overlay-x64-$shortCommit.zip"
if (Test-Path $finalZip) {
  throw "Refusing to overwrite an existing final delivery ZIP: $finalZip"
}
Compress-Archive -Path $artifactRoot -DestinationPath $finalZip -CompressionLevel Optimal
$zipHash = (Get-FileHash -Algorithm SHA256 $finalZip).Hash.ToLowerInvariant()
"$zipHash  $(Split-Path -Leaf $finalZip)" |
  Set-Content -Path "$finalZip.sha256" -Encoding ASCII

Write-Host "Final clean-validated delivery: $finalZip"
Write-Host "SHA-256: $zipHash"
