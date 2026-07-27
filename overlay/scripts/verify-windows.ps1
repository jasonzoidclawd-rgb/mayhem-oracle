param(
  [switch]$SkipInstallers
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$overlayRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $overlayRoot

Push-Location $repoRoot
try {
  npm ci
  npm test
  npx eslint src scripts
  npm run build

  Push-Location $overlayRoot
  try {
    npm ci
    npm test
    npm run build
    npm run audit:windows-artifact

    Push-Location (Join-Path $overlayRoot "src-tauri")
    try {
      cargo fmt --all -- --check
      cargo test
      cargo check
      cargo clippy --all-targets
    }
    finally {
      Pop-Location
    }

    if (-not $SkipInstallers) {
      npm run package:windows
      npm run audit:windows-artifact
      npm run audit:windows-artifact-names
    }
  }
  finally {
    Pop-Location
  }
}
finally {
  Pop-Location
}
