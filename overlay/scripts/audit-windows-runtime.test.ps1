$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "audit-windows-runtime-lib.ps1")

$assertions = 0

function Assert-Equal {
  param(
    [Parameter(Mandatory)]$Actual,
    [Parameter(Mandatory)]$Expected,
    [Parameter(Mandatory)][string]$Message
  )
  $script:assertions += 1
  if ($Actual -ne $Expected) {
    throw "$Message (expected $Expected, got $Actual)"
  }
}

function Assert-True {
  param(
    [Parameter(Mandatory)][bool]$Condition,
    [Parameter(Mandatory)][string]$Message
  )
  $script:assertions += 1
  if (-not $Condition) {
    throw $Message
  }
}

function Find-Hits {
  param(
    [Parameter(Mandatory)][string]$Text,
    [Parameter(Mandatory)][object[]]$Markers,
    [ValidateSet("ASCII", "UTF16")][string]$Encoding = "ASCII"
  )
  $bytes = if ($Encoding -eq "UTF16") {
    [Text.Encoding]::Unicode.GetBytes($Text)
  } else {
    [Text.Encoding]::ASCII.GetBytes($Text)
  }
  return @(Find-ForbiddenBinaryMarkers -BinaryBytes $bytes -Markers $Markers)
}

$emptyRoots = [ordered]@{}
$staticMarkers = @(Get-ForbiddenBinaryMarkers -KnownRoots $emptyRoots)

$genericUsersHits = @(Find-Hits -Text "prefix C:\Users\ suffix" -Markers $staticMarkers)
Assert-Equal $genericUsersHits.Count 0 "A generic Windows users prefix must not fail"
$genericForwardUsersHits = @(Find-Hits -Text "prefix C:/Users/ suffix" -Markers $staticMarkers)
Assert-Equal $genericForwardUsersHits.Count 0 "A generic forward-slash users prefix must not fail"

$profileRoots = [ordered]@{
  USERPROFILE = "C:\Users\BuildProfile"
}
$profileMarkers = @(Get-ForbiddenBinaryMarkers -KnownRoots $profileRoots)
Assert-Equal @(Find-Hits -Text "C:\Users\BuildProfile\AppData" -Markers $profileMarkers).Count 1 `
  "The concrete USERPROFILE path must fail"
Assert-Equal @(Find-Hits -Text "C:/Users/BuildProfile/AppData" -Markers $profileMarkers).Count 1 `
  "The forward-slash USERPROFILE path must fail"
Assert-Equal @(
  Find-Hits `
    -Text 'C:\Users\DependencyAuthor\p\ring\.debug$S' `
    -Markers $profileMarkers
).Count 0 "An unrelated upstream dependency CodeView path must not impersonate USERPROFILE"

$runnerRoots = [ordered]@{
  GITHUB_WORKSPACE = "D:\a\project\project"
  RUNNER_TEMP = "D:\a\_temp"
}
$runnerMarkers = @(Get-ForbiddenBinaryMarkers -KnownRoots $runnerRoots)
Assert-Equal @(Find-Hits -Text "D:\a\project\project\overlay" -Markers $runnerMarkers).Count 1 `
  "The concrete GITHUB_WORKSPACE path must fail"
Assert-Equal @(Find-Hits -Text "D:/a/_temp/build-output" -Markers $runnerMarkers).Count 1 `
  "The forward-slash RUNNER_TEMP path must fail"

$runnerWorkspaceMarkers = @(
  Get-ForbiddenBinaryMarkers -KnownRoots ([ordered]@{
    RUNNER_WORKSPACE = "E:\runner\workspace"
  })
)
Assert-Equal @(Find-Hits -Text "E:\runner\workspace\project" -Markers $runnerWorkspaceMarkers).Count 1 `
  "The concrete RUNNER_WORKSPACE path must fail"

$repositoryMarkers = @(
  Get-ForbiddenBinaryMarkers -KnownRoots ([ordered]@{
    repository = "F:\checkout\wasfun.lol"
  })
)
Assert-Equal @(Find-Hits -Text "F:/checkout/wasfun.lol/overlay" -Markers $repositoryMarkers).Count 1 `
  "The concrete repository checkout path must fail"

foreach ($marker in Get-StaticForbiddenBinaryMarkers) {
  $hits = @(Find-Hits -Text "prefix $($marker.Value) suffix" -Markers @($marker))
  Assert-Equal $hits.Count 1 "Static marker $($marker.Label) must remain enforced"
}

foreach ($unsafeRoot in @("", " ", "\", "/", "C:\", "d:/", "C:\Users\", "/Users/")) {
  $variants = @(Get-ConcretePathVariants -PathValue $unsafeRoot)
  Assert-Equal $variants.Count 0 "Empty and root-only paths must not become markers"
}

$macRoots = [ordered]@{
  HOME = "/Users/BuildProfile"
}
$macMarkers = @(Get-ForbiddenBinaryMarkers -KnownRoots $macRoots)
Assert-Equal @(Find-Hits -Text "/Users/BuildProfile/project" -Markers $macMarkers).Count 1 `
  "A concrete macOS build-host profile path must fail"

$utf16Hits = @(Find-Hits `
  -Text "prefix C:\Users\BuildProfile\AppData suffix" `
  -Markers $profileMarkers `
  -Encoding "UTF16")
Assert-Equal $utf16Hits.Count 1 "UTF-16 path matching must remain enforced"
Assert-Equal $utf16Hits[0].Encoding "UTF-16LE" "UTF-16 matches must identify their encoding"

$oddUtf16Bytes = [byte[]]@(0x7f) + [Text.Encoding]::Unicode.GetBytes(
  "C:\Users\BuildProfile\AppData"
)
$oddUtf16Hits = @(
  Find-ForbiddenBinaryMarkers -BinaryBytes $oddUtf16Bytes -Markers $profileMarkers
)
Assert-Equal $oddUtf16Hits.Count 1 "Odd-offset UTF-16 path matching must remain enforced"

$caseHits = @(Find-Hits -Text "c:\users\buildprofile\appdata" -Markers $profileMarkers)
Assert-Equal $caseHits.Count 1 "Marker matching must be case-insensitive"

$duplicateRoots = [ordered]@{
  FIRST = "D:\a\project"
  SECOND = "d:/a/project/"
}
$deduplicated = @(
  Get-ForbiddenBinaryMarkers -KnownRoots $duplicateRoots |
    Where-Object Kind -eq "concrete-path"
)
$deduplicatedValues = @($deduplicated | ForEach-Object { $_.Value.ToLowerInvariant() })
Assert-Equal (@($deduplicatedValues | Sort-Object -Unique)).Count $deduplicatedValues.Count `
  "Concrete path marker variants must be deduplicated case-insensitively"

$sensitiveHits = @(Find-Hits -Text "D:\a\project\project\overlay" -Markers $runnerMarkers)
Assert-True `
  (-not (($sensitiveHits | ForEach-Object Label) -join " " ).Contains("D:\a\project")) `
  "Match labels must not disclose concrete path values"

Write-Host "Windows runtime audit helper tests passed: $assertions assertions."
