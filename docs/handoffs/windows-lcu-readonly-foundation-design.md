# Windows LCU Read-Only Foundation Design

Date: 2026-07-01
Scope: M1 from `docs/plans/windows-client-acceleration-plan.md`.

## Goal

Add a tested Windows League Client Update discovery foundation for the Tauri
overlay without changing collector data semantics or adding any game-changing
LCU command surface.

This work adapts architecture lessons from `valkia/aramgg_client` only. No
source code is copied.

## Discovery Order

LCU credentials are local-only, ephemeral state. They are used only to contact
the local League client on `127.0.0.1` and must not be logged, uploaded, stored,
or included in telemetry.

Discovery order:

1. Running League process command line.
   - Parse `--remoting-auth-token` and `--app-port`.
   - Prefer this on Windows because it avoids stale lockfiles.
2. Lockfile next to the League executable directory.
   - Parse the standard `LeagueClient:pid:port:password:https` format.
3. Recent League client logs near the executable directory.
   - Use only as a fallback when command-line inspection and lockfile parsing
     are unavailable.
4. Known install-directory fallback.
   - Try common local League install roots.
   - Future UI may add a manual directory selector; the parser must reject bad
     paths cleanly.

Tests use fake process providers and temporary directories, so no live League
client or Windows host is required.

## Read-Only Boundary

M1 introduces normalized gameflow state from read-only LCU endpoints only:

- `/lol-gameflow/v1/gameflow-phase`
- `/lol-gameflow/v1/session`
- `/lol-champ-select/v1/session`

The overlay must not expose game-changing LCU operations. The client surface
must remain observation-only: no champion actions, bench swaps, trade actions,
ready-check actions, or other mutating LCU calls.

Existing collector reads remain privacy-bounded and read-only. This milestone
does not change collector upload semantics, generated data, freshness logic, or
member-coach authorization.

## Normalized Lifecycle

LCU phase strings are normalized before UI or collector code uses them:

- `InProgress`: live game capture can run.
- `ChampSelect`, `Lobby`, `EndOfGame`, and non-game phases: clear or pause
  game-only OCR/advisor state.
- Unknown phases remain inspectable as unknown and default to conservative
  no-capture behavior.

Collector background export remains paused while the client is in live-game
phases and may resume after the game leaves those phases, subject to consent,
manual pause, and the daily export limit.

## Verification

Required checks for this milestone:

```bash
(cd overlay/src-tauri && cargo test)
(cd overlay && npm test)
rg -n "pickOrBan|benchSwap|acceptTrade|declineTrade|/actions|DELETE|POST|PUT" overlay/src-tauri overlay/src
```

The grep check should show no write-capable LCU surface in overlay runtime code.
