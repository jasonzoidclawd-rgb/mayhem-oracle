# Overlay Current State

This file captures recent overlay findings so future agents do not rediscover
them from screenshots, terminal history, or old handoffs. It is context only.
Do not treat it as permission to change runtime behavior without a task.

## Latched Offer Lifecycle + Riot zh-TW Identity Bridge (2026-07-17, PR #46)

- `overlay/src/offerLifecycle.ts` owns augment-offer state: per-slot OCR-title
  fingerprints, latch-until-evidence clearing (2-pass surface absence, pick
  confirm, round boundary, focus loss, gameflow), per-slot reroll invalidation,
  and atomic generation publishes. Champion level is a round-boundary trigger
  ONLY — `transitionAugmentRound` no longer has `selectionComplete` (the level
  3→4 badge wipe root cause).
- OCR card identity (dev tier-fixture) resolves zh-TW OCR title → ARAMGG's
  Riot zh-TW catalog (`aram-mayhem-augments.zh_tw.json`) → canonical numeric
  augment ID → ARAMGG stats (`resolveOcrTitle` in `dev/aramggSource.ts`).
  Icons are never consulted (quest cards obscure them; generic icons are
  shared). Ambiguity rejects; zh-CN exact is a logged last resort.
  疾速追擊 (id 2100) was the proving case: local catalog has regressed English
  localized names + `lifecycle: "removed"`, so `buildOverlayAugmentLookup` now
  includes non-live augments (on-screen evidence trumps catalog lifecycle;
  pool prediction still excludes them).
- Badges are compact chips (`BADGE_CHIP_SIZE` 168×32) placed ABOVE the card
  frame derived from the detected name band (`cardFrameFromNameRect`), with
  side-anchor fallback and per-slot states: tier/WR, SCANNING, UNMATCHED,
  NO ARAMGG DATA. Dev calibration panel moved to bottom-left — top-right
  collided with the rightmost chip at 1280×720.
- Native `detect_augment_names` returns `captureMs`/`ocrMs`/`totalMs`
  (`OcrScanResult` also gained the missing serde camelCase rename); the
  frontend adds `matchMs`/`endToEndMs` to the diagnostics lifecycle panel.
- Known non-blockers: rustfmt drift pre-exists in `collector.rs`/`lcu.rs`/
  `member.rs`/`tests/member_contract.rs` (untouched); Windows MSVC
  cross-`cargo check` from macOS dies in `ring`'s C build (needs a Windows C
  toolchain) — Windows readiness is compile-gated but not machine-validated.

## Focus-Safety Finding

The old macOS focus trap came from rendering consent and collector controls
inside the same fullscreen transparent overlay window. That window also used
high-level macOS window behavior and click-through toggles, so controls inside
it could leave the transparent surface able to capture desktop input.

PR #21 (`codex/overlay-consent-focus` @ `8515ea7`) split the surfaces:

- `consent`: normal bounded consent/help-improve window.
- `collector-controls`: small bounded collector control window.
- `overlay`: fullscreen transparent visual surface.

Expected overlay contract after that branch:

- The main transparent overlay stays click-through by default.
- Consent and collector controls own mouse interaction in bounded windows.
- Collector polling remains single-owner; extra windows must not run duplicate
  collection/upload polling loops.
- User manually confirmed the focus-related behavior works.
- Do not assume PR #21 is merged until `gh pr view 21` says so.

## Member Coach And Auth

The member coach is still blocked by auth/entitlement rather than UI plumbing.

Verified finding:

- `MAYHEM_API_BASE=http://localhost:3000` changed the overlay banner from
  `api-base-not-configured` to `unauthenticated`.
- That proves the API base reaches Rust/Tauri.
- Tauri/Rust `reqwest` does not share browser cookies.

Recommended future auth path:

1. Overlay asks for a device code.
2. User links the device on the website account.
3. Overlay stores a device token.
4. Overlay sends `Authorization: Bearer <deviceToken>` to member APIs.

Do not try to fix member coach by relying on browser cookies inside Tauri.

## Collector Purpose

The collector is a safe anonymous data pipeline, not the gameplay coach. It
gathers privacy-bounded ARAM Mayhem match and round facts from consenting users.

Collector data supports:

- Private calibration.
- Patch drift checks.
- Model validation.
- Data quality review.

Collector data must not include:

- PUUIDs.
- Player names or Riot IDs.
- Chat.
- Screenshots.

Product direction:

- Collector UI should eventually become secondary or diagnostic.
- Member coach is the advisor UI.
- Do not turn collector status into gameplay recommendation UX.

## Compliance Boundary

Avoid hidden-information guidance. Do not expose game-session information the
player could not normally know.

This does not prohibit Oracle's core advisor logic over:

- Public patch data.
- The player's champion kit.
- Visible augment offers.
- Items.
- Explainable multiple-choice recommendations.

Do not build public augment win-rate pages.

## Roadmap Order

1. `overlay-consent-focus`
2. `overlay-device-auth`
3. `overlay-dev-fixture-mode`
4. `overlay-layout-manager`
5. `overlay-gameplay-ux`
6. Windows packaging/test matrix
