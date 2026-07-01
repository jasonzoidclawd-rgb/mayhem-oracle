# aramgg_client Windows Reference Research

Date: 2026-07-01
Source: https://github.com/valkia/aramgg_client
Default branch inspected: `master`
Git tree SHA from GitHub API: `8eef4efce1d9fa7a53a5e10ba846d5bcea4362b4`

## Scope

This is research only. No source code from `valkia/aramgg_client` was copied into
Mayhem Oracle. Treat the repository as an architecture reference unless license
permission is explicitly obtained.

## License Finding

Do not copy implementation code.

- GitHub repository metadata reports `license: null`.
- The repository tree did not show `LICENSE`, `LICENCE`, `COPYING`, or `NOTICE`.
- `package.json` has no visible license field and marks the package `private`.

Architecture patterns are useful; code reuse is not permitted without explicit
permission or a later license change.

## Reference Architecture Summary

`aramgg_client` is an Electron + Vue 3 + electron-vite Windows-first desktop
client. It uses Electron main-process services for LCU, screenshot capture, OCR,
data loading, window management, and packaging. The renderer is sandboxed and
reaches privileged operations only through a preload API.

The architecture maps to Mayhem Oracle as an acceleration reference in five
areas:

- Windows LCU credential discovery.
- Event-first gameflow lifecycle with polling fallback.
- Separate desktop overlay/control windows.
- In-memory screenshot capture with OCR gates and fixture tests.
- Windows packaging/update workflow.

## Findings By Topic

### 1. Windows LCU Token Discovery

Relevant files:

- `src/main/services/lcu/process-auth-discovery.ts`
- `src/main/services/lcu/token-loader.ts`
- `src/main/services/lcu/manual-directory-auth.ts`
- `src/main/modules/lol-path.ts`
- `docs/LCU_TROUBLESHOOTING.md`
- `tests/unit/lcu-process-auth-discovery.test.ts`
- `tests/unit/lcu-manual-directory-auth.test.ts`

Observed pattern:

- Query running `LeagueClientUx.exe` / `LeagueClient.exe` through Windows process
  information.
- Parse `--remoting-auth-token` and `--app-port`.
- If process command line is unavailable, try lockfile and recent
  `LeagueClientUx` logs near the executable path.
- If automatic discovery fails, use a manually configured League install
  directory only as a fallback.
- Log diagnostics without dumping full LCU payloads.

Mayhem adaptation:

- Adopt this discovery order conceptually for `overlay/src-tauri/src/lib.rs`.
- Keep Mayhem's Rust/Tauri implementation and port the behavior, not the code.
- Add Windows tests for command-line parsing, lockfile parsing, log fallback, and
  wrong-directory rejection.

### 2. OnJsonApiEvent WebSocket And Gameflow Polling

Relevant files:

- `src/main/services/lcu/lcu-wamp-socket.ts`
- `src/main/services/lcu/lcu-service.ts`
- `src/renderer/service/game-flow-monitor.ts`
- `docs/GAMEFLOW_DETECTION_GUIDE.md`
- `docs/ARAM_LCU_READONLY_RECOMMENDATION_PROGRESS.md`

Observed pattern:

- Subscribe to LCU WAMP topic `OnJsonApiEvent`.
- Filter for `/lol-gameflow/v1/gameflow-phase`.
- Use the event stream as the primary lifecycle signal.
- Keep `/lol-gameflow/v1/gameflow-phase` polling as reconnect and silence
  fallback.
- Use gameflow phase to start/stop expensive screenshot/OCR work.

Mayhem adaptation:

- Adopt event-first lifecycle management for the overlay collector/advisor.
- Keep a bounded polling fallback and one owner for polling.
- Do not expand from read-only gameflow/session observations into game
  automation.

### 3. Transparent Overlay Windows And Focus Behavior

Relevant files:

- `src/main/modules/window-manager.ts`
- `src/main/main.ts`
- `src/preload/preload.js`
- `docs/USER_GUIDE_AUTO_AUGMENT.md`

Observed pattern:

- Separate windows for main UI, popup, top floating augment overlay, and right
  side augment panel.
- Floating overlay is `transparent`, `alwaysOnTop`, `skipTaskbar`, and
  `focusable: false`.
- Control/detail windows can remain focusable, bounded, and separately routed.
- Renderer windows use `nodeIntegration: false`, `contextIsolation: true`,
  `sandbox: true`, and `webSecurity: true`.

Mayhem adaptation:

- This reinforces PR #21's direction: keep consent and controls in bounded
  windows, not inside the fullscreen transparent overlay.
- Keep the main transparent Mayhem overlay click-through/non-focusable by
  default.
- On Windows, prefer explicit per-window focus/click behavior over one monolithic
  transparent surface.

### 4. Screenshot/OCR Augment Card Detection

Relevant files:

- `src/main/auto-screenshot-service.ts`
- `src/main/screenshot.ts`
- `src/main/image-analyzer.ts`
- `src/main/augment-title-matcher.ts`
- `src/main/augment-partial-merge.ts`
- `tests/electron/test-augment-ocr-fixtures.js`
- `tests/fixtures/augment-ocr/manifest.json`
- `tests/unit/augment-partial-merge.test.js`
- `tests/unit/augment-title-text.test.js`
- `docs/USER_GUIDE_AUTO_AUGMENT.md`

Observed pattern:

- Capture in memory through Electron `desktopCapturer`; avoid default disk
  screenshot writes.
- Prefer the game window; fall back to screen capture.
- Gate OCR by gameflow phase, title-region activity, and reroll-button evidence.
- Use a dedicated OCR backend and fixture suite.
- Match recognized titles against a normalized augment title index.
- Preserve three-card slot order and handle partial reads separately from full
  detections.
- Save debug screenshots only to a local diagnostics directory.

Mayhem adaptation:

- Adopt the OCR pipeline shape: lifecycle gate, in-memory capture, bounded local
  debug artifacts, title matching, confidence, fixture tests.
- Keep Mayhem collector privacy stronger: no screenshots are uploaded, and
  screenshots should remain local diagnostics only.
- Do not reuse PaddleOCR integration code. Evaluate whether Tauri/Rust should use
  existing OCR bindings, a sidecar, or the current local Tesseract path.

### 5. Windows Packaging, NSIS, And Update Flow

Relevant files:

- `package.json`
- `.github/workflows/release-windows.yml`
- `installer/installer.nsh`
- `docs/ELECTRON_APP_UPDATE_STRATEGY.md`
- `src/main/app-update-service.ts`
- `src/main/modules/app-paths.ts`

Observed pattern:

- Windows release workflow on `windows-latest`.
- `npm ci --ignore-scripts`, lint, type-check, unit tests, then package.
- NSIS installer allows install-directory choice and normalizes into an app
  subdirectory.
- Release assets include installer `.exe`, `.blockmap`, and `latest.yml`.
- Auto-update is off by default and gated by remote config.
- Mutable runtime data is separated from packaged resources.

Mayhem adaptation:

- For Tauri, use this as a release checklist, not a technology mandate.
- Build a Windows CI matrix that verifies installer contents, bundled public
  data, OCR resources if included, and app-data/log paths.
- Keep auto-update disabled until signing, feed integrity, and staged rollout are
  designed.

### 6. Renderer Sandbox And Preload Security Model

Relevant files:

- `src/preload/preload.js`
- `src/main/modules/window-manager.ts`
- `electron.vite.config.mjs`
- `docs/ELECTRON_APP_UPDATE_STRATEGY.md`

Observed pattern:

- Renderer has no Node integration.
- Preload exposes a narrow `window.electronAPI`.
- Event subscriptions are allowlisted.
- `shell.openExternal` validates protocol.
- Update, screenshot, LCU, and diagnostics operations are IPC-mediated.

Mayhem adaptation:

- Tauri already gives a different permission model; keep capabilities narrow in
  `overlay/src-tauri/capabilities/default.json`.
- If Electron is evaluated later, require the same constraints: sandbox,
  context isolation, no renderer Node, allowlisted IPC, and no remote renderer
  JS.

### 7. Read-Only LCU Compliance Boundaries

Relevant files:

- `docs/ARAM_LCU_READONLY_RECOMMENDATION_PROGRESS.md`
- `docs/LCU_TROUBLESHOOTING.md`
- `src/main/services/lcu/ipc-handlers.ts`
- `src/main/services/lcu/lcu-service.ts`
- `src/main/services/aram/bench-recommendation.ts`

Observed pattern:

- The recommendation path is explicitly read-only.
- The docs prohibit `pickOrBan`, `benchSwap`, `action`, `acceptTrade`, and
  `declineTrade`.
- The app has separate mutating rune-page methods, but the recommendation path
  is documented as forbidden from using them.

Mayhem adaptation:

- Mayhem should go stricter: do not ship write-capable LCU methods in the
  overlay client unless a future compliance review explicitly approves them.
- Keep advisor/collector semantics as read-only LCU + visible OCR + local/public
  model data.
- Keep product language as recommendation/explanation, not decision dictation.

## What Mayhem Can Adopt As Architecture

- Windows process-first LCU discovery with lockfile/log/manual fallback.
- Event-first gameflow lifecycle with polling fallback.
- Per-window overlay roles: transparent visual surface, bounded controls, bounded
  consent/settings.
- In-memory screenshot processing with local-only diagnostics.
- OCR confidence gates and fixture-based regression tests.
- Strict sandbox/preload/capability boundary.
- Windows packaging checklist with explicit artifact verification.

## What Mayhem Must Not Copy

- Any source code, because no license is confirmed.
- Any third-party data model, win-rate payload, API key flow, or proprietary
  recommendation data.
- Any LCU write-action surface for champion selection, bench swapping, trades, or
  other gameplay-changing actions.
- Any hidden-information guidance or public augment win-rate surface.
- Any raw screenshot upload path.

## Tauri Versus Electron

Recommendation: keep Tauri for the next Windows milestone and evaluate Electron
only as a contingency.

Reasons to keep Tauri now:

- Mayhem already has a Tauri overlay, Rust collector, sanitizer, upload queue,
  and focus-safety work.
- The recent PR #21 split maps well to the per-window architecture lesson.
- Replatforming would delay member auth, OCR fixture mode, layout manager, and
  Windows packaging validation.

Reasons to evaluate Electron only if needed:

- Electron has mature `desktopCapturer`, `electron-builder`, NSIS, and
  `electron-updater` workflows.
- aramgg shows a proven Windows packaging/OCR/reference structure.
- If Tauri Windows capture/window APIs become the blocker, a short Electron
  spike may be justified.

Decision gate:

- Stay on Tauri if Windows LCU discovery, capture/OCR, focus, and packaging can
  be made reliable with Tauri plugins/Rust crates.
- Run an Electron spike only if one of those areas blocks M1 or M2 after a
  focused Tauri attempt.

## Suggested Mayhem Files For Later Branches

LCU discovery and read-only client:

- `overlay/src-tauri/src/lib.rs`
- `overlay/src-tauri/src/collector.rs`
- `overlay/src-tauri/tests/*`
- `overlay/src-tauri/fixtures/*`

Overlay windows and focus:

- `overlay/src/collector/collectorWindows.ts`
- `overlay/src/collector/collectorWindows.test.ts`
- `overlay/src/collector/CollectorStatus.tsx`
- `overlay/src/App.tsx`
- `overlay/src-tauri/tauri.conf.json`
- `overlay/src-tauri/capabilities/default.json`

OCR and augment selection:

- `overlay/src/App.tsx`
- `overlay/src/augmentSelection.ts`
- `src/lib/__tests__/augment-selection.test.ts`
- Future fixture path under `overlay/src-tauri/fixtures/` or
  `overlay/test-fixtures/ocr/`

Device/member auth:

- `overlay/src/auth/member.ts`
- `overlay/src/components/CoachPanel.tsx`
- `src/app/api/device/code/route.ts`
- `src/app/api/device/link/route.ts`
- `src/app/api/overlay/bootstrap/route.ts`

Packaging:

- `overlay/package.json`
- `overlay/src-tauri/tauri.conf.json`
- `.github/workflows/*`
- Future Windows signing/update docs under `docs/plans/`

## Risks

- License: no confirmed license; use only architecture concepts.
- Riot compliance: stay read-only, no game automation, no client injection.
- Anti-cheat: screen capture and overlay behavior must avoid process injection,
  memory reads, or simulated input.
- OCR privacy: screenshots must remain local; uploads must contain only
  de-identified round facts and confidence metadata.
- Focus: transparent overlays can trap input if controls live inside them.
- Packaging: Windows signing, installer trust prompts, update feed integrity, and
  resource bundling need a real Windows matrix.
