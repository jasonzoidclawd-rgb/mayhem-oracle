Set-StrictMode -Version Latest

function New-ForbiddenBinaryMarker {
  param(
    [Parameter(Mandatory)][string]$Label,
    [Parameter(Mandatory)][string]$Value,
    [Parameter(Mandatory)][ValidateSet("static", "concrete-path")][string]$Kind
  )
  return [pscustomobject]@{
    Label = $Label
    Value = $Value
    Kind = $Kind
  }
}

function Get-StaticForbiddenBinaryMarkers {
  $values = [ordered]@{
    "tier fixture environment marker" = "MAYHEM_OVERLAY_TIER_FIXTURE"
    "geometry preview environment marker" = "MAYHEM_OVERLAY_GEOMETRY_PREVIEW"
    "trace environment marker" = "MAYHEM_OVERLAY_TRACE"
    "dataset capture environment marker" = "MAYHEM_OVERLAY_DATASET_CAPTURE"
    "ARAMGG preview marker" = "ARAMGG PREVIEW"
    "tier fixture marker" = "TIER FIXTURE"
    "ARAMGG fixture marker" = "[aramgg-fixture]"
    "development-only data marker" = "data-dev-only"
  }
  foreach ($entry in $values.GetEnumerator()) {
    New-ForbiddenBinaryMarker -Label $entry.Key -Value $entry.Value -Kind "static"
  }
}

function Get-ConcretePathVariants {
  param([AllowNull()][AllowEmptyString()][string]$PathValue)

  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return
  }

  $trimmed = $PathValue.Trim() -replace '[\\/]+$', ''
  if (
    [string]::IsNullOrWhiteSpace($trimmed) -or
    $trimmed.Length -lt 4 -or
    $trimmed -match '^[A-Za-z]:$' -or
    $trimmed -match '^(?:[A-Za-z]:[\\/](?:Users|Documents and Settings)|/Users)$' -or
    $trimmed -match '^(?:\\\\|//)[^\\/]+$'
  ) {
    return
  }

  $variants = @(
    $trimmed
    $trimmed.Replace('\', '/')
    $trimmed.Replace('/', '\')
  )
  $seen = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::OrdinalIgnoreCase
  )
  foreach ($variant in $variants) {
    if ($seen.Add($variant)) {
      $variant
    }
  }
}

function Get-ForbiddenBinaryMarkers {
  param([Parameter(Mandatory)][System.Collections.IDictionary]$KnownRoots)

  $markers = [Collections.Generic.List[object]]::new()
  $seenValues = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::OrdinalIgnoreCase
  )

  foreach ($marker in Get-StaticForbiddenBinaryMarkers) {
    if ($seenValues.Add($marker.Value)) {
      $markers.Add($marker)
    }
  }

  foreach ($entry in $KnownRoots.GetEnumerator()) {
    $safeLabel = ([string]$entry.Key) -replace '[^A-Za-z0-9_.-]', '_'
    foreach ($variant in Get-ConcretePathVariants -PathValue ([string]$entry.Value)) {
      if ($seenValues.Add($variant)) {
        $markers.Add(
          (New-ForbiddenBinaryMarker `
            -Label "$safeLabel path" `
            -Value $variant `
            -Kind "concrete-path")
        )
      }
    }
  }

  return $markers
}

function Get-RustPathRemapFlags {
  param([Parameter(Mandatory)][System.Collections.IDictionary]$KnownRoots)

  $flags = [Collections.Generic.List[string]]::new()
  $flags.Add("-Ctarget-feature=+crt-static")
  $seenPrefixes = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::OrdinalIgnoreCase
  )

  foreach ($entry in $KnownRoots.GetEnumerator()) {
    $safeLabel = (([string]$entry.Key) -replace '[^A-Za-z0-9_.-]', '_').ToLowerInvariant()
    foreach ($variant in Get-ConcretePathVariants -PathValue ([string]$entry.Value)) {
      if (-not $seenPrefixes.Add($variant)) {
        continue
      }
      $flags.Add("--remap-path-prefix")
      $flags.Add("$variant=/__mayhem_build/$safeLabel")
    }
  }

  return $flags
}

function Join-CargoEncodedRustFlags {
  param([Parameter(Mandatory)][string[]]$Flags)
  return [string]::Join([char]0x1f, $Flags)
}

function Find-ForbiddenBinaryMarkers {
  param(
    [Parameter(Mandatory)][byte[]]$BinaryBytes,
    [Parameter(Mandatory)][object[]]$Markers
  )

  $binaryAscii = [Text.Encoding]::ASCII.GetString($BinaryBytes)
  $binaryUtf16Even = [Text.Encoding]::Unicode.GetString($BinaryBytes)
  $binaryUtf16Odd = if ($BinaryBytes.Length -gt 1) {
    [Text.Encoding]::Unicode.GetString($BinaryBytes, 1, $BinaryBytes.Length - 1)
  } else {
    ""
  }
  $matches = [Collections.Generic.List[object]]::new()
  $seenMatches = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::OrdinalIgnoreCase
  )

  foreach ($marker in $Markers) {
    if ([string]::IsNullOrWhiteSpace($marker.Value)) {
      continue
    }

    if ($binaryAscii.IndexOf($marker.Value, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
      $matchKey = "$($marker.Label)|ASCII"
      if ($seenMatches.Add($matchKey)) {
        $matches.Add([pscustomobject]@{
          Label = $marker.Label
          Kind = $marker.Kind
          Encoding = "ASCII"
        })
      }
    }

    if (
      $binaryUtf16Even.IndexOf($marker.Value, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
      $binaryUtf16Odd.IndexOf($marker.Value, [StringComparison]::OrdinalIgnoreCase) -ge 0
    ) {
      $matchKey = "$($marker.Label)|UTF-16LE"
      if ($seenMatches.Add($matchKey)) {
        $matches.Add([pscustomobject]@{
          Label = $marker.Label
          Kind = $marker.Kind
          Encoding = "UTF-16LE"
        })
      }
    }
  }

  return $matches
}
