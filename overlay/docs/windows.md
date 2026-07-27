# Windows build, runtime & architecture notes

Companion to the [0.5.0 release notes](./release-notes-0.5.0.md) and the
[human validation checklist](./windows-validation-checklist.md).

## Platform architecture

The overlay is one shared pipeline with narrow platform boundaries — it is **not**
duplicated per OS.

| Layer | Where | Windows specifics |
|-------|-------|-------------------|
| Window discovery | `platform` adapter → `CaptureTarget` | `EnumWindows` + owning executable identity; rejects invalid/hidden/minimized/cloaked windows and uses the physical client area. |
| Monitor enumeration | Win32 target observation + `xcap::Monitor::all` → `calibration` | `MonitorFromWindow`/`GetMonitorInfoW` establish identity and physical bounds; xcap selects the matching capture monitor. |
| Screen capture | `xcap` `capture_image` | Cross-platform, external, read-only. No injection. |
| Foreground detection | shared physical-single-flight scheduler + `platform::windows` | `GetForegroundWindow` / `GetWindowThreadProcessId` / owning executable identity. Process presence alone never authorizes capture. |
| Overlay window styling | `overlay_window` | `WS_EX_TRANSPARENT/NOACTIVATE/TOOLWINDOW/LAYERED`, `SetWindowPos` topmost. |
| DPI awareness | `overlay_window::set_process_dpi_aware_v2` | `SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)`. |
| Coordinate math | `calibration` (pure) | Same functions on both platforms; tested at 100–200% + negative origins. |
| Champion data / OCR / geometry / reroll / publication | shared TS + Rust | Identical on Windows. |

The non-portable window/capture-authority Rust lives behind
`#[cfg(target_os = "windows")]` in `platform/windows.rs`,
`overlay_window::windows_impl`, the Windows branch of `set_click_through`, and
the Windows setup block. Pure adapter selection, style-flag computation,
topmost policy and DPI conversions are unit-tested on every host.

## Capture backend rationale

Capture uses **`xcap`**, the same external, read-only screen/window capture the
macOS path uses. It requires no process injection, no League memory access and
no game hooks — it composites from the desktop only. A dedicated Windows
Graphics Capture backend was deliberately **not** introduced: `xcap` already
satisfies the read-only capture contract and is exercised by the existing tested
pipeline, so replacing it would add an unverifiable parallel capture surface for
no functional gain. If a future concrete defect proves `xcap` cannot capture a
specific League window mode on Windows, revisit with a cropped, per-window WGC
backend behind a `cfg` gate.

A wholesale capture failure is a **flagged, crop-less outcome**
(`capture_failure_diagnostics`) — every card region reports
`capture_succeeded = false` and no crops are produced (`crop_count == 0`). It is
never interpreted as a valid "the game shows zero cards" observation; card
presence is owned by the separate geometry track.

`xcap::Monitor::capture_image` is synchronous and not cancellable through the
current backend. Running it on a blocking worker does not cancel it. Logical
timeouts therefore publish uncertainty while the worker keeps its bounded
native permit until the call settles. Geometry and OCR use independent channel
limits, so one cannot starve the other.

## DPI behavior

The process declares **Per-Monitor DPI Awareness V2** at startup
(`SetProcessDpiAwarenessContext`), before any window/monitor geometry is read.
This keeps `xcap`'s physical-pixel rects and the overlay window in the same
coordinate space across mixed-DPI monitors and 100 / 125 / 150 / 175 / 200 %
scaling. `calibration::capture_rect_for_monitor` and
`calibration::physical_to_logical_rect` do the physical↔logical conversions and
are unit-tested for each scale, for secondary monitors, and for negative-origin
monitors (a display placed left of / above the primary).

Windowed mode uses `GetClientRect` + `ClientToScreen`, excluding the title bar
and borders. `GetDpiForWindow` and a privacy-safe target digest invalidate late
work after any HWND, client-size, monitor, resolution, or DPI transition.

If you prefer a manifest-based declaration instead of the runtime call, embed an
application manifest with
`<dpiAwareness>PerMonitorV2</dpiAwareness>`; the runtime call is a harmless
no-op when the OS already set awareness.

## Overlay window behavior

The single overlay window is created from `tauri.conf.json` (transparent,
decorations off, always-on-top, skip-taskbar) and then styled natively:

- `WS_EX_LAYERED` — per-pixel transparency.
- `WS_EX_TRANSPARENT` — mouse input passes through to the game (click-through).
- `WS_EX_NOACTIVATE` — the overlay never takes focus or steals activation.
- `WS_EX_TOOLWINDOW` — kept out of Alt+Tab / taskbar navigation.
- `SetWindowPos(HWND_TOPMOST | HWND_NOTOPMOST, …, SWP_NOACTIVATE)` — topmost
  **only while League is the foreground owner**; dropped otherwise so the
  overlay never floats over unrelated applications.

Styles and z-order are re-asserted on a ~1.5 s loop (WebView2 can reset extended
styles), mirroring the macOS level re-assert loop. The window is never created
or destroyed at runtime — only restyled/repositioned.

## Build prerequisites (Windows)

- Windows 10 (supported) or Windows 11.
- Rust stable (`rustup default stable`).
- Node.js 22.
- **WebView2 Runtime** (present on Windows 11; installed via bootstrapper by the
  installer on Windows 10).
- **NSIS** for the `-setup.exe` (`choco install nsis`). WiX for MSI is fetched by
  Tauri automatically.
- MSVC build tools (Visual Studio C++ workload) for linking.
- A Windows 10/11 SDK selected by the Visual Studio Installer.

## Build commands (Windows)

```powershell
# from repo root
powershell -ExecutionPolicy Bypass -File overlay/scripts/verify-windows.ps1
```

Pass `-SkipInstallers` for the compile/test gates without NSIS/MSI packaging.

Installers are written to
`overlay/src-tauri/target/release/bundle/{nsis,msi}/`.

## Unsigned build warning

These artifacts are **unsigned development / release-candidate** builds. No
code-signing certificate is configured and none is fabricated. Windows
SmartScreen will warn ("Windows protected your PC") on first launch. Do not
represent these as production-signed releases.

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| **League window not found** | Game not in a real match, foreground, visible, capturable client area, or the window is minimized/cloaked. Authority comes from the owning executable, not the window title. |
| **Black / empty capture** | GPU/driver capture restriction or exclusive-fullscreen mode. Use borderless windowed. Capture is read-only; a failure shows as flagged diagnostics, not an empty offer. |
| **Stale capture** | Capture session stalled; the re-assert loop and OCR watchdog recover. Alt+Tab to League to force re-acquire. |
| **Wrong scale / offset overlay** | DPI awareness not applied. Confirm `SetProcessDpiAwarenessContext` runs (dev log) or embed a PerMonitorV2 manifest. Verify the monitor scale in the calibration diagnostic. |
| **Overlay offset from cards** | Mixed-DPI monitor move; the calibration re-runs on `get_overlay_calibration`. Move League fully onto one monitor and re-check. |
| **WebView2 missing** | Install the Evergreen WebView2 Runtime (or run the installer, which bootstraps it). |
| **`DATA ERROR` badge** | Champion-augment fetch failed (network/CDN). It never falls back to a global value; retry once connectivity returns. |
| **`NO CHAMP DATA` badge** | The champion's complete dataset genuinely has no row for that augment. This is correct, not an error. |

## Compliance

External, read-only window detection and screen capture only. No process
injection, no League memory reading, no input automation, no matchmaking or
gameplay automation. See the repository `AGENTS.md` overlay-compliance section.
