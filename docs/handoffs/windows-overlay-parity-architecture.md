# Windows overlay parity architecture

Date: 2026-07-27
Source committed HEAD: `49dd04b97155a13e82d84e5af0a5db9156e9a4f1`
Branch: `feat/overlay-tier-card-windows-parity`

## Architecture map

| Layer | Shared | macOS native | Windows native |
| --- | --- | --- | --- |
| Foreground scheduling | Physical single-flight, logical freshness, epochs, late rejection in `foregroundPollScheduler.ts` | CGWindow z-order authority with NSWorkspace fallback | Win32 foreground HWND plus adapter observation |
| Window/process authority | Pure process identity and bounded failure results | Bundle/executable owner identity | HWND owning PID and executable identity |
| Capture target | `CaptureTarget`, target-generation invalidation, calibration math | Existing xcap/CGWindow behavior preserved | Visible, valid, non-minimized, non-cloaked client area + monitor + DPI |
| Screen capture | Existing bounded per-channel ownership and `xcap` | xcap monitor capture | xcap monitor capture |
| OCR | Three crops, shared matching and slot ownership | Apple Vision | Windows.Media.Ocr |
| Offer/lifecycle/rendering | Shared TypeScript only | No fork | No fork |
| Diagnostics | Development-only, bounded markers | Existing macOS candidate walk | Booleans, enums and target digest only; no title/path/PID/HWND/OCR text |

The native window boundary is `overlay/src-tauri/src/platform/`. Pure selection
consumes `WindowObservation` and returns `CaptureTarget` or
`PlatformFailureReason`. The mock adapter tests do not need a Windows desktop.

## Windows APIs and bindings

The existing `windows = 0.61` dependency is used; no second Win32 crate was
added.

- `GetForegroundWindow`
- `GetWindowThreadProcessId`
- `EnumWindows`
- `OpenProcess` and `QueryFullProcessImageNameW`
- `IsWindow`, `IsWindowVisible`, `IsIconic`
- `GetClientRect` and `ClientToScreen`
- `MonitorFromWindow` and `GetMonitorInfoW`
- `GetDpiForWindow`
- `DwmGetWindowAttribute(DWMWA_CLOAKED)`

`SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)` remains the startup DPI
contract. Client rectangles and monitor bounds are physical virtual-desktop
coordinates and may have negative origins.

## Capture authority and invalidation

Process presence is cached symmetrically for 5 seconds and is diagnostic only.
It cannot authorize capture. A Windows capture requires a fresh foreground HWND
whose owning executable is the actual League game process and whose client area
is valid, visible, not minimized, not cloaked, non-empty, monitor-associated and
DPI-resolved.

The target digest includes native window/process identity, client bounds,
monitor identity/bounds and DPI. Only the digest crosses IPC. A move, resize,
resolution, monitor, DPI, PID, or HWND transition bumps the frontend foreground
epoch; geometry/OCR results from the older target reject as stale. Capture also
rechecks the digest after `xcap` returns, closing the race inside one native
call.

## Capture and OCR backends

The existing `xcap 0.9` monitor capture remains the smallest compatible backend.
It supplies both the full frame used by geometry and the frame from which the
three card-name crops are extracted. Geometry and OCR keep independent native
admission counters, logical owners and late-publication checks.

`xcap::Monitor::capture_image` is synchronous and not cancellable through the
current API. `spawn_blocking` does not cancel it. A timeout is uncertainty; the
blocking worker retains its permit until the OS call settles. The per-channel
cap bounds native work and prevents one channel from starving the other.

Windows OCR remains `Windows.Media.Ocr` through the existing `windows` crate.
Installed recognizer languages are preferred by game locale; matching,
thresholds and aliases remain shared. Raw OCR text travels only in the internal
recognition result required for matching and is not copied into diagnostics.

## Deterministic coverage

Native mock/pure tests cover:

- matching game foreground versus process-present/non-game foreground;
- stale HWND, minimized and cloaked rejection;
- process-cache reuse, expiry and refresh;
- 100/125/150/175/200 percent scaling;
- negative monitor coordinates and left/above monitor placement;
- borderless and windowed client-area viewport selection;
- target-generation changes on monitor/DPI/resolution transitions;
- separate bounded geometry/OCR ownership and cross-channel non-starvation.

The committed shared suites already cover physical foreground single-flight,
logical freshness, late result rejection, bounded/coalesced probe scheduling,
capture uncertainty versus fresh zero-card closure, stale geometry hiding,
entry-animation settlement, hover hysteresis, slot-local rerolls, atomic
three-card replacement and LCU-confirmed-live ownership preservation.

Claude's unfinished hover/R4 work is intentionally excluded; see
`windows-parity-pending-claude-hover-r4.md`.

## Build and validation boundary

On Windows, install Node 22, Rust stable, Visual Studio 2022 Build Tools with
Desktop development with C++, a Windows 10/11 SDK, WebView2 Runtime, and NSIS.
Run:

```powershell
powershell -ExecutionPolicy Bypass -File overlay/scripts/verify-windows.ps1
```

Use `-SkipInstallers` for compile/test-only validation. Tauri writes unsigned
installers below:

- `overlay/src-tauri/target/release/bundle/nsis/`
- `overlay/src-tauri/target/release/bundle/msi/`

No signing certificate or signing secret is configured. The existing workflow
is verification-only and does not publish a release. This branch does not
change or activate CI.

The source commit already fails repository-wide `cargo fmt --all -- --check`
in `foreground.rs`, `lcu.rs`, `lib.rs`, `member.rs`, `surface_probe.rs`, and
two existing integration tests. This branch leaves that unrelated formatting
debt intact. Its new platform and calibration files pass standalone
`rustfmt --check`; the verification script deliberately retains the strict
repository-wide gate so a Windows run cannot silently overlook the baseline
failure.

macOS can run shared/pure tests and native macOS builds. A Windows Rust target
installed on macOS is insufficient for the full application: transitive C
dependencies need MSVC and Windows SDK headers. Native Win32/Tauri packaging
must run on a real Windows runner, and League/OCR/capture behavior still needs
controlled human validation on real Windows hardware.
