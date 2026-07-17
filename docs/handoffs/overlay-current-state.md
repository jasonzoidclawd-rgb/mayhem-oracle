# Overlay Current State

This file captures recent overlay findings so future agents do not rediscover
them from screenshots, terminal history, or old handoffs. It is context only.
Do not treat it as permission to change runtime behavior without a task.

## Death-Delivery Round Model + CSS-Space Chips (2026-07-17, PR #46 round 2)

Second fix round on PR #46 after the timed manual GUI test surfaced six
defects. Root causes and current contracts:

- **Round delivery**: Mayhem rounds R2–R4 are delivered during the DEATH
  sequence, not at level thresholds. Levels 3/7/11/15 only create
  eligibility. `overlay/src/roundDelivery.ts` owns the model:
  `pendingRounds = eligibleRoundCount(level) − completedRounds`, completion
  counted on strong evidence only (keydown pick confirm, or a queued offer
  replacing a latched validated one — `replacedOffer`), chained R2→R3→R4.
  `augment_selection` phase enters ONLY when a validated offer surface
  latches (fast OCR loop or ambient probe), never from a level poll —
  `transitionAugmentRound`/`shouldStartAugmentSelection` are deleted.
  Scan modes: `fast` (offer latched, or death sequence with pending
  rounds), `ambient` (pending rounds, one probe per 1.5s poll tick),
  `off`.
- **Foreground authority**: `NSWorkspace.frontmostApplication` off the
  main thread returns values up to ~18s stale (game reported while
  Terminal focused → chip/window leak onto desktop). The topmost layer-0
  CGWindowList window is now the authority
  (`foreground::effective_frontmost_pid`); workspace value is only a
  fallback for fullscreen game surfaces with no layer-0 window.
- **Coordinate space**: `OverlayCalibration.overlay_anchor` (macOS:
  monitor rect; Windows: repositioned viewport) is the single conversion
  boundary — `cssRectFromCalibratedRect(rect, anchor, cssWindow)` runs
  exactly once per rect. `scaleFactor`/`devicePixelRatio` are display
  metadata only; using either for geometry reintroduces the 1.0↔2.0
  chip-position flap.
- **Chips**: 118×32 CSS px, `[S+ · 61.6%]`, placed above the full card
  frame (icon band 0.17 + name band + body band 0.24 of game height),
  side-anchor fallback, withheld (null) rather than ever rendered inside
  a card or over the reroll/upgrade control zones.
- **Placeholder hygiene**: zero-validated scans are absence evidence —
  `surfaceVisible` drops on the first such pass (chips hide, fixes the
  33s stale placeholders and scoreboard occlusion), the latch survives
  one pass for restore, clears after two.
- **Win rate**: `overlay/src/winRateFormat.ts` — exact string decimal
  shift + half-up one-decimal rounding ("0.5915" → "59.2%"); never
  `Number()*100`/`toFixed`. Tier glyphs render in a bundled OFL Anton
  latin woff2 (no runtime font fetch; `productionFont.test.ts` audits
  source + dist).
- Windows remains compile-gated, not machine-validated: no physical
  Windows build has run.

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
