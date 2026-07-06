# Windows Client Alpha — Manual Smoke Test

Date: 2026-07-06
Scope: unsigned internal alpha of the Tauri overlay on a real Windows League
machine. This is a verification checklist, not a release procedure.

## Artifact

Use the NSIS installer from either:

- GitHub Actions artifact `mayhem-oracle-overlay-windows-unsigned` from the
  `Windows Overlay` workflow run for the branch under test, or
- a local build: `cd overlay && npm ci && npm run package:windows`, then
  `overlay/src-tauri/target/release/bundle/nsis/*.exe`.

The artifact is unsigned. SmartScreen will warn — choose "More info → Run
anyway". Do not sign, do not publish, do not enable any updater.

Prerequisite on the test machine: Tesseract OCR on PATH
(`tesseract --version` works in a fresh terminal), plus language packs for the
League client language in use (`eng` minimum; `chi_tra`/`chi_sim`/`jpn`/`kor`
if testing those locales).

## Steps

Record pass/fail per step. For failures, capture the exact on-screen text and
the reproduction path.

1. **Install** the unsigned alpha via the NSIS installer. Expect: installs
   without admin-elevation loops; app appears in Start menu.
2. **Start the League client** (do not enter a game yet).
3. **Launch the overlay.** Expect: a tray icon appears with an
   "Exit Mayhem Oracle" right-click menu; no console window.
4. **Consent window appears** as a normal bounded window (title
   "Mayhem Oracle Consent"). Verify the desktop behind it still accepts
   clicks — the transparent full-screen overlay must NOT trap mouse input
   anywhere on screen.
5. **Consent choices.** Decline: overlay UI stays disabled and the collector
   controls window offers re-enable only. Re-launch/Enable then Accept:
   consent window closes itself.
6. **Collector controls window** appears after consent as a separate small
   bounded window (pause/resume, daily counter). It is interactive; the rest
   of the screen stays click-through.
7. **LCU detection.** With the League client running, the overlay shows the
   waiting/connected state ("Client found — waiting for game..."). Kill the
   League client and confirm it falls back to "Waiting for League client...".
8. **Enter a game** — Practice Tool or Arena/ARAM Mayhem if available.
9. **Gameflow transitions.** Lobby → ChampSelect → InProgress: the overlay
   must stay idle (no OCR, no badges) until the game is actually in progress.
10. **OCR only during live capture.** Badges/OCR activity may appear only
    in-game at augment levels (3/7/11/15) and only while the League game
    window is focused. Alt-Tab away mid-selection: badges must disappear.
    OCR must never run in champ select, lobby, or at the desktop.
11. **Click-through with coach closed.** In-game with no coach panel open,
    clicks must land in the game, not the overlay.
12. **Upload hygiene.** With collector accepted, let at least one augment
    round record, then inspect the queued/exported payloads under
    `%APPDATA%` (app data dir `com.mayhem-oracle.overlay`). Confirm: no
    summoner names, Riot IDs, PUUIDs, chat, screenshots, or raw LCU JSON —
    only de-identified round fields and a hashed game id.
13. **Member auth states.** Unauthenticated: overlay shows the
    "Member coach unavailable: ..." notice and keeps running (no crash);
    member badges stay hidden. Authenticated + entitled account: badges and
    coach panel ("C") appear.
14. **Exit game.** On EndOfGame/back-to-lobby the badges, HUD, and any stale
    matched cards must clear; the overlay returns to the waiting state.
15. **Quit the overlay** from the tray menu. Expect: overlay windows close
    and no `mayhem-oracle-overlay` process remains in Task Manager.

## Evidence to capture

- Screenshot: consent window over the desktop (step 4).
- Screenshot: collector controls window (step 6).
- Screenshot: badges during one augment selection (step 10) — crop to the
  card area; no chat, scoreboard, or player names in the crop.
- Log/notes: gameflow phases observed at steps 9 and 14 (the status dot
  color transitions are sufficient evidence).
- The audited payload finding from step 12 (field names only, no values).

Do NOT commit: full screenshots, any capture containing player names / chat /
minimap / scoreboard / Riot IDs / PUUIDs, raw LCU payloads, LCU ports or auth
tokens, or any secrets. Cropped augment-card regions only, per
`docs/handoffs/windows-ocr-fixture-policy.md`.

## Known alpha limitations

- Unsigned binary (SmartScreen warning is expected).
- No auto-update; new builds are manual reinstalls.
- Exclusive-fullscreen League may render above the overlay; use Borderless
  or Windowed mode for the alpha.
- OCR card regions are tuned for 16:9 primary-monitor layouts.
