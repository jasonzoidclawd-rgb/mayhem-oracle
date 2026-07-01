# Windows Client Acceleration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** accelerate Mayhem Oracle's Windows overlay by adapting architecture
lessons from `valkia/aramgg_client` without copying unlicensed source code.

**Architecture:** keep the existing Tauri overlay as the primary client, add
Windows LCU discovery and OCR hardening in small testable slices, and preserve
the PR #21 split-window focus model. Use Electron only as a time-boxed fallback
evaluation if Tauri blocks LCU, capture/OCR, or packaging.

**Tech Stack:** Tauri 2, Rust, React/TypeScript overlay, Next.js APIs, existing
Mayhem public data, local OCR, GitHub Actions Windows runners.

---

## Non-Negotiable Boundaries

- Do not copy `aramgg_client` source code; no license is confirmed.
- Do not add public augment win-rate pages.
- Do not upload screenshots, PUUIDs, Riot IDs, names, chat, or raw LCU payloads.
- Do not call LCU endpoints that change game state.
- Do not build game automation, client injection, memory reading, or simulated
  input.
- Keep collector polling single-owner.
- Keep the transparent overlay click-through by default.

## M1: Windows Read-Only LCU Foundation

Goal: make Windows LCU discovery and gameflow state reliable enough for
collector/advisor lifecycle decisions.

Files likely touched:

- `overlay/src-tauri/src/lib.rs`
- `overlay/src-tauri/src/collector.rs`
- `overlay/src-tauri/fixtures/*`
- `overlay/src-tauri/tests/*`
- `overlay/src/collector/CollectorStatus.tsx`
- `docs/handoffs/*`

Tasks:

- [ ] Add a Windows LCU discovery design note before coding.
  - Include process command-line discovery, lockfile fallback, log fallback, and
    manual directory fallback.
  - Explicitly mark all discovered credentials as local-only ephemeral state.
- [ ] Add Rust unit tests for lockfile parsing and bad-path handling.
  - Run: `(cd overlay/src-tauri && cargo test)`
  - Expected: parser tests pass without a live League client.
- [ ] Add Windows process-discovery abstraction with a fake provider in tests.
  - Real implementation may use PowerShell/WMI/process inspection, but tests must
    not require Windows.
- [ ] Add read-only gameflow phase retrieval and state normalization.
  - Allowed paths: `/lol-gameflow/v1/gameflow-phase`,
    `/lol-gameflow/v1/session`, `/lol-champ-select/v1/session`.
  - Forbidden paths: `pickOrBan`, `benchSwap`, `action`, `acceptTrade`,
    `declineTrade`.
- [ ] Wire collector/advisor lifecycle to normalized phase.
  - `InProgress`: allow OCR/advisor capture.
  - `ChampSelect`, `Lobby`, `EndOfGame`: pause or clear game-only OCR state.
- [ ] Verify no write-capable LCU command is exposed in Tauri invoke handlers.
  - Run: `rg -n "pickOrBan|benchSwap|acceptTrade|declineTrade|/actions|DELETE|POST|PUT" overlay/src-tauri overlay/src`
  - Expected: no advisor/collector path exposes game-changing LCU operations.

Verification:

```bash
(cd overlay/src-tauri && cargo test)
(cd overlay && npm test)
```

Exit criteria:

- Windows LCU discovery has tested parsing/fallback behavior.
- Collector/advisor can consume read-only phase state.
- No generated public data changes.

## M2: Windows OCR And Overlay Lifecycle Hardening

Goal: make Windows augment-offer OCR reliable while preserving privacy and focus
safety.

Files likely touched:

- `overlay/src/App.tsx`
- `overlay/src/augmentSelection.ts`
- `src/lib/__tests__/augment-selection.test.ts`
- `overlay/src/collector/collectorWindows.ts`
- `overlay/src/collector/collectorWindows.test.ts`
- `overlay/src-tauri/src/lib.rs`
- Future OCR fixtures under `overlay/test-fixtures/ocr/`

Tasks:

- [ ] Add local OCR fixture policy.
  - Fixtures may contain cropped/sanitized augment-card screenshots only.
  - Full screenshots stay out of git unless explicitly sanitized and reviewed.
- [ ] Add fixture tests for three-card order, partial reads, reroll/refresh
  frames, and disappearing card text.
  - Run: `npm test -- src/lib/__tests__/augment-selection.test.ts`
  - Expected: card lifecycle and alias matching remain stable.
- [ ] Add capture lifecycle gates from normalized gameflow.
  - No OCR outside active game phases.
  - Clear stale results after phase exit.
  - Keep collector status diagnostic, not gameplay-advisory.
- [ ] Preserve split-window focus contract.
  - Consent window: bounded, focusable, non-transparent.
  - Collector controls: bounded, explicit interaction.
  - Main overlay: transparent visual surface, click-through by default.
- [ ] Add Windows manual validation checklist.
  - Alt-Tab behavior.
  - League remains focusable.
  - Overlay does not trap input.
  - OCR diagnostics remain local.

Verification:

```bash
(cd overlay && npm test)
npm test
(cd overlay && npm run build)
```

Exit criteria:

- OCR runs only in allowed phases.
- No screenshots or identity data leave the device.
- Overlay windows do not regress PR #21 focus safety.

## M3: Windows Packaging And Distribution Matrix

Goal: produce a Windows build path that can be tested, signed later, and rolled
out without weakening update/security boundaries.

Files likely touched:

- `overlay/package.json`
- `overlay/src-tauri/tauri.conf.json`
- `.github/workflows/*`
- `docs/plans/windows-client-acceleration-plan.md`
- Future release/signing docs under `docs/handoffs/*`

Tasks:

- [x] Add a Windows build workflow for the Tauri overlay.
  - Use `windows-latest`.
  - Install Rust and Node dependencies.
  - Run overlay tests before packaging.
- [x] Verify packaged resources.
  - Public data present.
  - Tauri capabilities present.
  - OCR binary/model resources present if bundled.
  - No `.env`, Riot keys, raw screenshots, raw LCU payloads, or BigQuery
    credentials in artifacts.
- [x] Add unsigned-build warning and signing plan.
  - Document expected Windows trust prompts for unsigned builds.
  - Do not enable auto-update until signing/feed integrity is designed.
- [x] Evaluate Tauri updater only after packaging is stable.
  - Keep app code/resources local.
  - Do not remote-load renderer JS.
  - Require HTTPS feed, hash verification, staged rollout, rollback path, and
    user-visible update status.
- [ ] Run a short Electron contingency spike only if Tauri blocks the milestone.
  - Spike output must be a decision note, not a replatforming branch.
  - Compare LCU discovery, capture/OCR, focus behavior, installer, updater,
    signing, binary size, and maintenance cost.

Verification:

```bash
(cd overlay && npm test)
(cd overlay && npm run build)
```

Windows runner verification once workflow exists:

```bash
gh workflow run <windows-overlay-workflow>
gh run watch
```

Exit criteria:

- Windows artifact can be built in CI.
- Artifact contents are audited.
- Tauri remains viable or Electron has a documented evidence-based reason to
  revisit.

## Suggested Later Branch Order

1. `codex/windows-lcu-readonly-foundation`
2. `codex/windows-ocr-fixture-mode`
3. `codex/windows-overlay-focus-matrix`
4. `codex/windows-tauri-packaging`
5. `codex/electron-contingency-spike`, only if a Tauri blocker is verified

## Reference Files Inspected

External `valkia/aramgg_client` files inspected:

- `README.md`
- `package.json`
- `.github/workflows/release-windows.yml`
- `installer/installer.nsh`
- `electron.vite.config.mjs`
- `src/main/main.ts`
- `src/main/modules/window-manager.ts`
- `src/main/modules/app-paths.ts`
- `src/main/services/lcu/process-auth-discovery.ts`
- `src/main/services/lcu/token-loader.ts`
- `src/main/services/lcu/manual-directory-auth.ts`
- `src/main/services/lcu/lcu-service.ts`
- `src/main/services/lcu/lcu-wamp-socket.ts`
- `src/main/services/lcu/ipc-handlers.ts`
- `src/renderer/service/game-flow-monitor.ts`
- `src/preload/preload.js`
- `src/main/auto-screenshot-service.ts`
- `src/main/screenshot.ts`
- `src/main/image-analyzer.ts`
- `src/main/augment-title-matcher.ts`
- `src/main/augment-partial-merge.ts`
- `tests/electron/test-augment-ocr-fixtures.js`
- `docs/ARAM_LCU_READONLY_RECOMMENDATION_PROGRESS.md`
- `docs/LCU_TROUBLESHOOTING.md`
- `docs/USER_GUIDE_AUTO_AUGMENT.md`
- `docs/ELECTRON_APP_UPDATE_STRATEGY.md`

Local Mayhem files inspected:

- `docs/handoffs/current-github-context.md`
- `docs/handoffs/overlay-current-state.md`
- `docs/handoffs/riot-api-discovery-report.md`
- `docs/plans/riot-api-bigquery-discovery.md`
- `CLAUDE.md`
- `AGENTS.md`
- `overlay/src-tauri/src/lib.rs`
- `overlay/src/collector/collectorWindows.ts`
- `overlay/src/collector/collectorWindows.test.ts`
- `overlay/src/App.tsx`

## Risks To Track

- License: architecture-only until permission is confirmed.
- Riot compliance: read-only LCU and visible-offer OCR only.
- Anti-cheat: no injection, no memory reads, no simulated input.
- OCR privacy: local screenshots only; uploads stay de-identified.
- Focus: transparent overlay must never own global focus unexpectedly.
- Packaging: Windows signing and update feed integrity are not optional for
  broad distribution.
